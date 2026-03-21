import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BridgeCommand } from "./types.js";

export type ActionLogEntry = {
  requestId: string;
  playerUuid: string;
  playerName: string;
  command: BridgeCommand;
  timestamp: string;
};

export class ActionLogger {
  constructor(private readonly path: string) {}

  async log(entry: ActionLogEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
