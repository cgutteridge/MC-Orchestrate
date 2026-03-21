import { ActionLogger } from "./bridge/actionLog.js";
import { BridgeServer } from "./bridge/bridgeServer.js";
import { loadConfig } from "./config/env.js";
import { createHttpServer } from "./http/server.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { PlannerLogger } from "./planner/planLogger.js";
import { createChatProvider } from "./services/ai/provider.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const actionLogger = new ActionLogger(config.minecraft.actionLogPath);
  const plannerLogger = new PlannerLogger(config.ai.plannerLogPath);
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

  const provider = createChatProvider(config);
  const orchestrator = new Orchestrator(bridge, provider, plannerLogger);

  await bridge.start();
  await createHttpServer(
    orchestrator,
    config.minecraft.httpHost,
    config.minecraft.httpPort,
  );
}

/**
 * Bootstraps the local bridge, planner, and HTTP entrypoint for the repo.
 */
main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exit(1);
});
