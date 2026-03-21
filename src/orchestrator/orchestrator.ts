import { BridgeServer } from "../bridge/bridgeServer.js";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest, ChatCommandResponse } from "../types/plugin.js";
import { buildAiPlan } from "../planner/aiPlanner.js";
import { compilePlanToBridgeCommands } from "../planner/compilePlan.js";
import type { PlannerLogger } from "../planner/planLogger.js";
import { buildHeuristicPlan } from "../planner/heuristicPlanner.js";
import { resolvePlanMaterials } from "../planner/materialResolver.js";
import { validatePlanSafety } from "../planner/safety.js";
import { validatePlanSemantics } from "../planner/semantics.js";
import type { Plan } from "../planner/schema.js";

/**
 * Coordinates chat requests, planning, safety checks, and bridge execution.
 */
export class Orchestrator {
  private readonly recentMessagesByPlayer = new Map<string, string[]>();
  private readonly lastBuiltStructurePlanByPlayer = new Map<string, Plan>();

  constructor(
    private readonly bridge: BridgeServer,
    private readonly provider?: ChatProvider,
    private readonly plannerLogger?: PlannerLogger,
  ) {}

  /**
   * Handles a single in-game chat command from the plugin boundary.
   */
  async handleChatCommand(
    request: ChatCommandRequest,
  ): Promise<ChatCommandResponse> {
    const planningRequest = this.withConversationHistory(request);
    const previousPlan = this.lastBuiltStructurePlanByPlayer.get(request.player.uuid);

    try {
      let plan: Plan | undefined;
      if (this.provider) {
        try {
          plan = await buildAiPlan(this.provider, planningRequest, this.plannerLogger);
        } catch {
          plan = undefined;
        }
      }
      plan ??= buildHeuristicPlan(planningRequest, previousPlan);

      if (!plan) {
        return {
          status: "needs_more_info",
          reply: "I need a more specific building instruction.",
          requestId: request.requestId,
          intent: "unknown",
        };
      }

      plan = resolvePlanMaterials(plan, planningRequest);

      const unsafeReason = validatePlanSafety(planningRequest, plan);
      if (unsafeReason) {
        return {
          status: "rejected",
          reply: unsafeReason,
          requestId: request.requestId,
          intent: plan.intent,
        };
      }

      const semanticReason = validatePlanSemantics(plan);
      if (semanticReason) {
        return {
          status: "rejected",
          reply: semanticReason,
          requestId: request.requestId,
          intent: plan.intent,
        };
      }

      if (plan.needsMoreInfo || plan.passes.length === 0) {
        return {
          status: "needs_more_info",
          reply:
            plan.clarification ??
            (plan.passes.length === 0
              ? "I need a more concrete building plan for that request."
              : plan.reply),
          requestId: request.requestId,
          intent: plan.intent,
        };
      }

      const commands = compilePlanToBridgeCommands(plan);
      for (const [index, command] of commands.entries()) {
        try {
          await this.bridge.executeCommand(command, {
            requestId: request.requestId,
            playerUuid: request.player.uuid,
            playerName: request.player.name,
          });
        } catch (error) {
          const detail =
            error instanceof Error ? error.message : String(error);
          const reply = `Step ${index + 1} of ${commands.length} failed: ${detail}`;

          try {
            await this.bridge.executeCommand(
              {
                kind: "say",
                message: `[Bot] ${request.player.name}: ${reply}`,
              },
              {
                requestId: request.requestId,
                playerUuid: request.player.uuid,
                playerName: request.player.name,
              },
            );
          } catch {
            // Preserve the original execution failure when player notification also fails.
          }

          return {
            status: "error",
            reply,
            requestId: request.requestId,
            intent: plan.intent,
          };
        }
      }

      await this.bridge.executeCommand(
        { kind: "say", message: `${request.player.name}: ${plan.reply}` },
        {
          requestId: request.requestId,
          playerUuid: request.player.uuid,
          playerName: request.player.name,
        },
      );
      if (isBuiltStructurePlan(plan)) {
        this.lastBuiltStructurePlanByPlayer.set(request.player.uuid, plan);
      }

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
    } finally {
      this.rememberMessage(planningRequest.player.uuid, planningRequest.recentMessages, planningRequest.message);
    }
  }

  private withConversationHistory(request: ChatCommandRequest): ChatCommandRequest {
    const remembered = this.recentMessagesByPlayer.get(request.player.uuid) ?? [];
    const merged = [...remembered, ...request.recentMessages]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(-10);
    return {
      ...request,
      recentMessages: merged,
    };
  }

  private rememberMessage(playerUuid: string, recentMessages: string[], message: string): void {
    const next = [...recentMessages, message.trim()]
      .filter((entry) => entry.length > 0)
      .slice(-10);
    this.recentMessagesByPlayer.set(playerUuid, next);
  }
}

function isBuiltStructurePlan(plan: Plan): boolean {
  for (const pass of plan.passes) {
    for (const primitive of pass.primitives) {
      if (
        primitive.type === "set_block" ||
        primitive.type === "fill_cuboid" ||
        primitive.type === "hollow_cuboid" ||
        primitive.type === "cylinder"
      ) {
        return true;
      }
    }
  }
  return false;
}
