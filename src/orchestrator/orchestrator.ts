import { BridgeServer } from "../bridge/bridgeServer.js";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest, ChatCommandResponse } from "../types/plugin.js";
import { WorldReader } from "../world/worldReader.js";
import { buildAiPlan } from "../planner/aiPlanner.js";
import { compilePlanToBridgeCommands } from "../planner/compilePlan.js";
import { buildHeuristicPlan } from "../planner/heuristicPlanner.js";
import { validatePlanSafety } from "../planner/safety.js";

/**
 * Coordinates chat requests, planning, safety checks, and bridge execution.
 */
export class Orchestrator {
  private readonly worldReader: WorldReader;

  constructor(
    private readonly bridge: BridgeServer,
    minecraftDir: string,
    private readonly provider?: ChatProvider,
  ) {
    this.worldReader = new WorldReader(minecraftDir);
  }

  /**
   * Handles a single in-game chat command from the plugin boundary.
   */
  async handleChatCommand(
    request: ChatCommandRequest,
  ): Promise<ChatCommandResponse> {
    try {
      let plan =
        buildHeuristicPlan(request) ??
        (this.provider ? await buildAiPlan(this.provider, request) : undefined);

      if (!plan) {
        const levelSummary = await this.worldReader.readLevelMetadata();
        const regions = await this.worldReader.listRegionFiles();
        return {
          status: "needs_more_info",
          reply:
            levelSummary || regions.length > 0
              ? "I need a more specific building instruction."
              : "I need a more specific instruction.",
          requestId: request.requestId,
          intent: "unknown",
        };
      }

      const unsafeReason = validatePlanSafety(request, plan);
      if (unsafeReason) {
        return {
          status: "rejected",
          reply: unsafeReason,
          requestId: request.requestId,
          intent: plan.intent,
        };
      }

      if (plan.needsMoreInfo || plan.passes.length === 0) {
        return {
          status: "needs_more_info",
          reply: plan.clarification ?? plan.reply,
          requestId: request.requestId,
          intent: plan.intent,
        };
      }

      const commands = compilePlanToBridgeCommands(plan);
      for (const command of commands) {
        await this.bridge.executeCommand(command, {
          requestId: request.requestId,
          playerUuid: request.player.uuid,
          playerName: request.player.name,
        });
      }

      await this.bridge.executeCommand(
        { kind: "say", message: `${request.player.name}: ${plan.reply}` },
        {
          requestId: request.requestId,
          playerUuid: request.player.uuid,
          playerName: request.player.name,
        },
      );

      return {
        status: "executed",
        reply: plan.reply,
        requestId: request.requestId,
        intent: plan.intent,
        executedActions: commands.length,
      };
    } catch (error) {
      return {
        status: "error",
        reply: `I hit an error: ${error instanceof Error ? error.message : String(error)}`,
        requestId: request.requestId,
        intent: "unknown",
      };
    }
  }
}
