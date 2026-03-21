import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";
import type { ActionLogger } from "./actionLog.js";
import { normalizeBatchBlocks, serializeBridgeCommand } from "./serialize.js";
import type { BridgeCommand } from "./types.js";

type BridgeServerOptions = {
  host: string;
  port: number;
  minecraftDir: string;
  minecraftJar: string;
  javaBin?: string;
};

/**
 * Owns the local Minecraft server process and the bounded bridge command protocol.
 */
export class BridgeServer {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly blocksToSet = new Map<string, string>();
  private readonly managedBlocks = new Map<string, string>();
  private minecraft: ChildProcessWithoutNullStreams | undefined;
  private serverReady = false;
  private updateBlocksTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly options: BridgeServerOptions,
    private readonly actionLogger: ActionLogger,
  ) {
    const minecraftDir = path.resolve(process.cwd(), options.minecraftDir);
    const minecraftJarPath = path.join(minecraftDir, options.minecraftJar);
    if (!existsSync(minecraftJarPath)) {
      throw new Error(`Minecraft server jar not found: ${minecraftJarPath}`);
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  /**
   * Starts the Minecraft child process and the TCP bridge listener.
   */
  async start(): Promise<void> {
    this.minecraft = this.spawnMinecraft();

    this.minecraft.stdout.on("data", (data) => {
      const text = data.toString();
      if (/\[Server thread\/INFO\]: Done/.test(text)) {
        this.serverReady = true;
        this.sendAll(`$SERVER_READY=${this.serverReady}\n`);
        process.stdout.write("READY\n");
      }
      process.stdout.write(text);
    });

    this.minecraft.stderr.on("data", (data) => {
      const text = data.toString();
      process.stderr.write(text);
      this.sendAll(`stderr: ${text}`);
    });

    this.minecraft.on("close", (code) => {
      process.stdout.write(`child process exited with code ${code}\n`);
      process.exit(code ?? 0);
    });

    process.stdin.on("data", (data) => {
      this.requireMinecraft().stdin.write(data);
    });

    this.scheduleBlockUpdates();
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.port, this.options.host, () => {
        process.stdout.write(
          `TCP Server is running on port ${this.options.port}.\n`,
        );
        resolve();
      });
    });
  }

  /**
   * Executes a validated bridge command and records it in the action log when context is provided.
   */
  async executeCommand(
    command: BridgeCommand,
    context?: { requestId: string; playerUuid: string; playerName: string },
  ): Promise<void> {
    const minecraft = this.requireMinecraft();

    if (command.kind === "batchSet") {
      for (const block of normalizeBatchBlocks(command.blocks)) {
        this.blocksToSet.set(`${block.x} ${block.y} ${block.z}`, block.type);
      }
      this.scheduleBlockUpdates(1);
    } else if (command.kind === "setBlock") {
      this.blocksToSet.set(
        `${command.x} ${command.y} ${command.z}`,
        command.block,
      );
      this.scheduleBlockUpdates(1);
    } else {
      for (const line of serializeBridgeCommand(command)) {
        minecraft.stdin.write(`${compileMinecraftCommand(line)}\n`);
      }
    }

    if (context) {
      await this.actionLogger.log({
        requestId: context.requestId,
        playerUuid: context.playerUuid,
        playerName: context.playerName,
        command,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleConnection(socket: Socket): void {
    process.stdout.write(
      `CONNECTED: ${socket.remoteAddress}:${socket.remotePort}\n`,
    );
    socket.write("WELCOME TO MCORCH\n");
    socket.write(`$SERVER_READY=${this.serverReady}\n`);
    this.sockets.add(socket);

    socket.on("data", (data) => {
      const commands = data.toString().trim().split(/\n/);
      for (const line of commands) {
        this.handleLine(socket, line);
      }
    });

    socket.on("close", () => {
      this.sockets.delete(socket);
      process.stdout.write(
        `CLOSED: ${socket.remoteAddress} ${socket.remotePort}\n`,
      );
    });
  }

  private handleLine(socket: Socket, line: string): void {
    if (!line) {
      return;
    }
    const spaceIndex = line.indexOf(" ");
    const command = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const param = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1).trim();

    switch (command) {
      case "say":
        socket.write("(cmd say)\n");
        this.requireMinecraft().stdin.write(`say ${param}\n`);
        return;
      case "stop":
        socket.write("(cmd stop)\n");
        this.requireMinecraft().stdin.write("stop\n");
        return;
      case "setBlock": {
        const p = param.split(/\s+/);
        if (p.length !== 4) {
          socket.write("setBlock needs exactly 4 parameters\n");
          return;
        }
        this.blocksToSet.set(`${p[0]} ${p[1]} ${p[2]}`, p[3]);
        this.scheduleBlockUpdates(1);
        socket.write(`(cmd setBlock) ${param}\n`);
        return;
      }
      case "fill": {
        const p = param.split(/\s+/);
        if (p.length !== 7) {
          socket.write("fill needs exactly 7 parameters\n");
          return;
        }
        this.requireMinecraft().stdin.write(
          `fill ${p[0]} ${p[1]} ${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]}\n`,
        );
        socket.write(`(cmd fill) ${param}\n`);
        return;
      }
      case "replace": {
        const p = param.split(/\s+/);
        if (p.length !== 8) {
          socket.write("replace needs exactly 8 parameters\n");
          return;
        }
        this.requireMinecraft().stdin.write(
          `fill ${p[0]} ${p[1]} ${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[7]} replace ${p[6]}\n`,
        );
        socket.write(`(cmd replace) ${param}\n`);
        return;
      }
      case "batchSet": {
        try {
          const blocks = normalizeBatchBlocks(
            JSON.parse(param) as Array<{
              x: number;
              y: number;
              z: number;
              type: string;
            }>,
          );
          for (const block of blocks) {
            this.blocksToSet.set(`${block.x} ${block.y} ${block.z}`, block.type);
          }
          this.scheduleBlockUpdates(1);
          socket.write(`(cmd batchSet) ${blocks.length}\n`);
        } catch (error) {
          socket.write(
            `batchSet invalid JSON: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
        return;
      }
      default:
        socket.write(`Unknown command ${command}\n`);
    }
  }

  private scheduleBlockUpdates(delay = 100): void {
    if (this.updateBlocksTimer) {
      return;
    }
    this.updateBlocksTimer = setTimeout(() => this.updateBlocks(), delay);
  }

  private updateBlocks(): void {
    this.updateBlocksTimer = undefined;
    const next = this.blocksToSet.entries().next();
    if (next.done) {
      return;
    }
    const [coords, type] = next.value;
    this.blocksToSet.delete(coords);

    if (this.managedBlocks.get(coords) !== type) {
      this.requireMinecraft().stdin.write(`setblock ${coords} ${type} replace\n`);
      this.managedBlocks.set(coords, type);
    }
    this.scheduleBlockUpdates(1);
  }

  private spawnMinecraft(): ChildProcessWithoutNullStreams {
    return spawn(
      this.resolveJavaBin(),
      ["-jar", this.options.minecraftJar, "nogui"],
      {
        cwd: path.resolve(process.cwd(), this.options.minecraftDir),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
  }

  private resolveJavaBin(): string {
    const javaCandidates = [
      this.options.javaBin,
      "/opt/homebrew/opt/openjdk@21/bin/java",
      "java",
    ].filter(Boolean) as string[];
    return (
      javaCandidates.find(
        (candidate) => candidate === "java" || existsSync(candidate),
      ) ?? "java"
    );
  }

  private requireMinecraft(): ChildProcessWithoutNullStreams {
    if (!this.minecraft) {
      throw new Error("Minecraft server process has not been started.");
    }
    return this.minecraft;
  }

  private sendAll(message: string): void {
    for (const socket of this.sockets) {
      socket.write(message);
    }
  }
}

function compileMinecraftCommand(command: string): string {
  if (command.startsWith("replace ")) {
    const p = command.split(/\s+/);
    return `fill ${p[1]} ${p[2]} ${p[3]} ${p[4]} ${p[5]} ${p[6]} ${p[8]} replace ${p[7]}`;
  }
  return command;
}
