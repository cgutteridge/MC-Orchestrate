import { BridgeServer } from "../bridge/bridgeServer.js";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest, ChatCommandResponse } from "../types/plugin.js";
import { runDesignLoop, runVerifyPass } from "../planner/aiPlanner.js";
import { compilePlanToBridgeCommands } from "../planner/compilePlan.js";
import type { PlannerLogger } from "../planner/planLogger.js";
import { resolvePlanMaterials } from "../planner/materialResolver.js";
import { resolvePlacement, shiftPlan, computePlanCenter } from "../planner/placement.js";
import { validatePlanSafety } from "../planner/safety.js";
import { validatePlanSemantics } from "../planner/semantics.js";
import type { Plan } from "../planner/schema.js";
import {
  compilePlanToDig,
  type DesignIntentGraph,
} from "../planner/dig.js";
import { WorldReader } from "../world/worldReader.js";
import type { ChatMessage } from "../services/ai/types.js";
import {
  orchestratorEmptyPlanMessage,
  orchestratorUnexpectedErrorMessage,
} from "../planner/playerRefusalMessages.js";

/**
 * Coordinates chat requests, AI design loop planning, safety checks, and
 * bridge execution. All build decisions are delegated to the AI — there is no
 * heuristic fallback.
 */
export class Orchestrator {
  private readonly recentMessagesByPlayer = new Map<string, string[]>();
  private readonly lastBuiltStructurePlanByPlayer = new Map<string, Plan>();
  /** DIG store — persists alongside the Plan store for follow-up refinement. */
  private readonly lastDigByPlayer = new Map<string, DesignIntentGraph>();
  /**
   * Message history from the last completed design loop per player. Used by
   * the verify pass so it can inspect the full AI context.
   */
  private readonly lastLoopMessagesByPlayer = new Map<string, ChatMessage[]>();

  constructor(
    private readonly bridge: BridgeServer,
    private readonly worldReader: WorldReader,
    private readonly provider?: ChatProvider,
    private readonly plannerLogger?: PlannerLogger,
  ) {}

  /**
   * Handles a single in-game chat command from the plugin boundary.
   *
   * Immediately broadcasts a "Thinking…" acknowledgement so the player knows
   * the request was received. Then runs the multi-turn AI design loop,
   * validates and executes the resulting plan, and optionally performs a
   * post-build verify + polish pass when the AI requests one.
   */
  async handleChatCommand(
    request: ChatCommandRequest,
  ): Promise<ChatCommandResponse> {
    // No AI provider configured — fail fast with a clear message.
    if (!this.provider) {
      return {
        status: "needs_more_info",
        reply:
          "No AI builder is configured on this orchestrator (missing chat provider / Azure OpenAI settings). " +
          "An admin needs to set the provider environment variables before I can design or place blocks.",
        requestId: request.requestId,
        intent: "unknown",
      };
    }

    const planningRequest = this.withConversationHistory(request);
    const previousPlan = this.lastBuiltStructurePlanByPlayer.get(request.player.uuid);

    // Acknowledge immediately so the player isn't left waiting in silence.
    try {
      await this.bridge.executeCommand(
        { kind: "say", message: `${request.player.name}: Thinking about your request...` },
        {
          requestId: request.requestId,
          playerUuid: request.player.uuid,
          playerName: request.player.name,
        },
      );
    } catch {
      // Do not abort the request if the acknowledgement fails.
    }

    try {
      // -----------------------------------------------------------------------
      // Run the AI design loop
      // -----------------------------------------------------------------------
      const loopResult = await runDesignLoop(
        this.provider,
        planningRequest,
        this.worldReader,
        previousPlan,
        this.plannerLogger,
        this.bridge.getPlacedBlocks(),
      );

      if (loopResult.outcome === "needs_more_info") {
        return {
          status: "needs_more_info",
          reply: loopResult.clarification,
          requestId: request.requestId,
          intent: "unknown",
        };
      }

      // Resolve the placement intent to a world-space anchor and reposition
      // the plan's centre to that anchor. The AI's shape (primitive dimensions
      // and relative layout) is preserved; only the position is replaced.
      // This is safe because the AI correctly expresses INTENT (verified via
      // the debug message below) but gets the look-vector rotation wrong when
      // computing absolute world coordinates itself.
      const lastBuiltPlan = this.lastBuiltStructurePlanByPlayer.get(request.player.uuid);
      const lastBuildCenter = lastBuiltPlan ? computePlanCenter(lastBuiltPlan) : undefined;
      const intentAnchor = resolvePlacement(loopResult.placement, planningRequest, lastBuildCenter);
      const aiCenter = computePlanCenter(loopResult.plan);
      const reanchorOffset = {
        x: intentAnchor.x - aiCenter.x,
        y: intentAnchor.y - aiCenter.y,
        z: intentAnchor.z - aiCenter.z,
      };

      // Broadcast the resolved placement so the player can verify it.
      try {
        await this.bridge.executeCommand(
          {
            kind: "say",
            message: `[Bot] Placement: ${describePlacement(loopResult.placement)} → world (${intentAnchor.x},${intentAnchor.y},${intentAnchor.z})`,
          },
          { requestId: request.requestId, playerUuid: request.player.uuid, playerName: request.player.name },
        );
      } catch { /* non-fatal */ }

      let plan = shiftPlan(loopResult.plan, reanchorOffset);

      // -----------------------------------------------------------------------
      // Material resolution and safety/semantic validation
      // -----------------------------------------------------------------------
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
              ? orchestratorEmptyPlanMessage(planningRequest)
              : plan.reply),
          requestId: request.requestId,
          intent: plan.intent,
        };
      }

      // -----------------------------------------------------------------------
      // Execute the plan
      // -----------------------------------------------------------------------
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
          const reply = `Execution stopped: step ${index + 1} of ${commands.length} failed (${detail}). ` +
            `Earlier steps may already have changed the world — say what you see and we can fix or undo manually.`;

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
            // Preserve the original failure when notification also fails.
          }

          return {
            status: "error",
            reply,
            requestId: request.requestId,
            intent: plan.intent,
          };
        }
      }

      // -----------------------------------------------------------------------
      // Post-build verify + optional polish pass
      // -----------------------------------------------------------------------
      // The design loop signals a verify request by setting verifyRegion on the
      // build step. We recover the raw build JSON from the planner logger in
      // production; for now we reconstruct from the plan. The loop messages are
      // tracked so the verify pass has full context.
      const loopPlan = plan;
      await this.tryVerifyAndPolish(planningRequest, loopPlan);

      // -----------------------------------------------------------------------
      // Announce completion and persist state
      // -----------------------------------------------------------------------
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
        this.lastDigByPlayer.set(
          request.player.uuid,
          compilePlanToDig(plan, request.player.uuid),
        );
      }

      return {
        status: "executed",
        reply: plan.reply,
        requestId: request.requestId,
        intent: plan.intent,
        executedActions: commands.length,
      };
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error);
      return {
        status: "error",
        reply: orchestratorUnexpectedErrorMessage(detail),
        requestId: request.requestId,
        intent: "unknown",
      };
    } finally {
      this.rememberMessage(
        planningRequest.player.uuid,
        planningRequest.recentMessages,
        planningRequest.message,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Attempts a post-build verify + polish pass. Runs silently — errors are
   * swallowed so they do not break the primary execution response.
   */
  private async tryVerifyAndPolish(
    request: ChatCommandRequest,
    builtPlan: Plan,
  ): Promise<void> {
    if (!this.provider) {
      return;
    }
    try {
      const priorMessages = this.lastLoopMessagesByPlayer.get(request.player.uuid);
      if (!priorMessages || priorMessages.length === 0) {
        return;
      }

      // Use the plan's targetRegion (expanded by 2 blocks) as verify region.
      const vr = builtPlan.targetRegion;
      const verifyRegion = {
        world: vr.world,
        min: { x: vr.min.x - 2, y: vr.min.y - 2, z: vr.min.z - 2 },
        max: { x: vr.max.x + 2, y: vr.max.y + 2, z: vr.max.z + 2 },
      };

      const polishPlan = await runVerifyPass(
        this.provider,
        request,
        priorMessages,
        JSON.stringify({ action: "build", plan: builtPlan }),
        verifyRegion,
        this.worldReader,
        this.plannerLogger,
        this.bridge.getPlacedBlocks(),
      );

      if (!polishPlan) {
        return;
      }

      const polishResolved = resolvePlanMaterials(polishPlan, request);
      if (validatePlanSafety(request, polishResolved) || validatePlanSemantics(polishResolved)) {
        return;
      }
      if (polishResolved.needsMoreInfo || polishResolved.passes.length === 0) {
        return;
      }

      const polishCommands = compilePlanToBridgeCommands(polishResolved);
      for (const command of polishCommands) {
        await this.bridge.executeCommand(command, {
          requestId: request.requestId,
          playerUuid: request.player.uuid,
          playerName: request.player.name,
        });
      }
    } catch {
      // Polish pass errors are non-fatal.
    }
  }

  private withConversationHistory(request: ChatCommandRequest): ChatCommandRequest {
    const remembered = this.recentMessagesByPlayer.get(request.player.uuid) ?? [];
    const merged = [...remembered, ...request.recentMessages]
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(-10);
    return { ...request, recentMessages: merged };
  }

  private rememberMessage(
    playerUuid: string,
    recentMessages: string[],
    message: string,
  ): void {
    const next = [...recentMessages, message.trim()]
      .filter((entry) => entry.length > 0)
      .slice(-10);
    this.recentMessagesByPlayer.set(playerUuid, next);
  }
}

/**
 * Formats a placement intent as a short human-readable string for in-game
 * debug output so the player can verify what the AI decided.
 *
 * Example: "player_view → forward:8, left:3, up:5"
 */
function describePlacement(p: import("../planner/schema.js").Placement): string {
  const parts: string[] = [];

  if (p.ref === "player_view") {
    if (p.forward)  parts.push(`forward:${p.forward}`);
    if (p.back)     parts.push(`back:${p.back}`);
    if (p.left)     parts.push(`left:${p.left}`);
    if (p.right)    parts.push(`right:${p.right}`);
  } else {
    if (p.north)    parts.push(`north:${p.north}`);
    if (p.south)    parts.push(`south:${p.south}`);
    if (p.east)     parts.push(`east:${p.east}`);
    if (p.west)     parts.push(`west:${p.west}`);
  }
  if (p.up)   parts.push(`up:${p.up}`);
  if (p.down) parts.push(`down:${p.down}`);

  const offsets = parts.length > 0 ? ` → ${parts.join(", ")}` : " → at origin";
  return `${p.ref}${offsets}`;
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
