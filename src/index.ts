import path from "node:path";
import { ActionLogger } from "./bridge/actionLog.js";
import { BridgeServer } from "./bridge/bridgeServer.js";
import { loadConfig } from "./config/env.js";
import { createHttpServer } from "./http/server.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { createChatProvider } from "./services/ai/provider.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const actionLogger = new ActionLogger(config.minecraft.actionLogPath);
  const bridge = new BridgeServer(
    {
      host: config.minecraft.tcpHost,
      port: config.minecraft.tcpPort,
      minecraftDir: config.minecraft.minecraftDir,
      minecraftJar: config.minecraft.minecraftJar,
      javaBin: config.minecraft.javaBin,
    },
    actionLogger,
  );

  const provider = createChatProvider();
  const orchestrator = new Orchestrator(
    bridge,
    path.resolve(process.cwd(), config.minecraft.minecraftDir),
    provider,
  );

  await bridge.start();
  await createHttpServer(
    orchestrator,
    config.minecraft.httpHost,
    config.minecraft.httpPort,
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
