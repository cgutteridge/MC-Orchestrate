import { describeBridgeCommand } from "../bridge/describeCommand.js";
import { BridgeServer } from "../bridge/bridgeServer.js";
import type { BridgeCommand } from "../bridge/types.js";
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

/** Minimum bridge operations before mid-run percentage announcements. */
const PROGRESS_ANNOUNCE_MIN_OPS = 20;

/**
 * When {@link PROGRESS_ANNOUNCE_MIN_OPS} is met, returns 25 / 50 / 75 when
 * `completed` matches the first step count for that percentage (inclusive).
 */
function progressPercentMilestone(
  completed: number,
  total: number,
): 25 | 50 | 75 | undefined {
  if (total < PROGRESS_ANNOUNCE_MIN_OPS) {
    return undefined;
  }
  const milestones: (25 | 50 | 75)[] = [25, 50, 75];
  for (const m of milestones) {
    const threshold = Math.ceil((total * m) / 100);
    if (completed === threshold) {
      return m;
    }
  }
  return undefined;
}

type BridgeExecutionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "cancelled";
      completed: number;
      total: number;
    }
  | {
      ok: false;
      reason: "bridge_error";
      failedIndex: number;
      detail: string;
      completedBeforeFailure: number;
      total: number;
    };

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
   *
   * @param request Validated plugin payload for this chat turn.
   * @param options Optional `AbortSignal` (e.g. when the HTTP client disconnects)
   *   to cooperatively cancel planning and bridge execution between steps.
   */
  async handleChatCommand(
    request: ChatCommandRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ChatCommandResponse> {
    const signal = options?.signal;

    if (signal?.aborted) {
      return {
        status: "error",
        reply: "Request was cancelled.",
        requestId: request.requestId,
        intent: "unknown",
        cancelled: true,
      };
    }

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
        { signal },
      );

      if (loopResult.outcome === "cancelled") {
        return {
          status: "error",
          reply: "Request was cancelled.",
          requestId: request.requestId,
          intent: "unknown",
          cancelled: true,
        };
      }

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
      const execution = await this.executeBridgeCommands(
        commands,
        request,
        signal,
        true,
      );

      if (!execution.ok) {
        if (execution.reason === "cancelled") {
          const reply =
            execution.completed === 0
              ? "Build cancelled before any blocks were placed."
              : `Build cancelled after ${execution.completed} of ${execution.total} operations. ` +
                "The world may be partially changed.";
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
            /* non-fatal */
          }
          return {
            status: "error",
            reply,
            requestId: request.requestId,
            intent: plan.intent,
            executedActions: execution.completed,
            cancelled: true,
          };
        }

        const failedCommand = commands[execution.failedIndex]!;
        const summary = describeBridgeCommand(failedCommand);
        const detail =
          execution.detail;
        const reply =
          `Execution stopped: step ${execution.failedIndex + 1} of ${execution.total} failed (${summary}): ${detail}. ` +
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
          executedActions: execution.completedBeforeFailure,
          failedCommandSummary: summary,
        };
      }

      // -----------------------------------------------------------------------
      // Post-build verify + optional polish pass
      // -----------------------------------------------------------------------
      // The design loop signals a verify request by setting verifyRegion on the
      // build step. We recover the raw build JSON from the planner logger in
      // production; for now we reconstruct from the plan. The loop messages are
      // tracked so the verify pass has full context.
      const loopPlan = plan;
      await this.tryVerifyAndPolish(planningRequest, loopPlan, signal);

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
   *
   * @param request Original player request.
   * @param builtPlan Plan that was just executed.
   * @param signal When aborted, verify and polish steps are skipped.
   */
  private async tryVerifyAndPolish(
    request: ChatCommandRequest,
    builtPlan: Plan,
    signal: AbortSignal | undefined,
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
        { signal },
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
      const polishExec = await this.executeBridgeCommands(
        polishCommands,
        request,
        signal,
        false,
      );
      if (!polishExec.ok) {
        return;
      }
    } catch {
      // Polish pass errors are non-fatal.
    }
  }

  /**
   * Runs bridge commands with optional in-game progress (`say`) for the main
   * build. Cooperative cancellation is checked before each command.
   *
   * @param commands Compiled bridge operations for one plan.
   * @param request Player context for logging and `say` lines.
   * @param signal Optional abort from the HTTP layer.
   * @param emitProgress When true, announces total op count and 25/50/75%
   *   milestones for large builds.
   * @returns Success, bridge failure with step index, or cancellation.
   */
  private async executeBridgeCommands(
    commands: BridgeCommand[],
    request: ChatCommandRequest,
    signal: AbortSignal | undefined,
    emitProgress: boolean,
  ): Promise<BridgeExecutionResult> {
    const total = commands.length;

    if (emitProgress && total > 0) {
      try {
        await this.bridge.executeCommand(
          {
            kind: "say",
            message: `[Bot] Building… (${total} operation${total === 1 ? "" : "s"}).`,
          },
          {
            requestId: request.requestId,
            playerUuid: request.player.uuid,
            playerName: request.player.name,
          },
        );
      } catch {
        /* non-fatal */
      }
    }

    for (let index = 0; index < total; index++) {
      if (signal?.aborted) {
        return { ok: false, reason: "cancelled", completed: index, total };
      }

      const command = commands[index]!;

      try {
        await this.bridge.executeCommand(command, {
          requestId: request.requestId,
          playerUuid: request.player.uuid,
          playerName: request.player.name,
        });
      } catch (error) {
        const detail =
          error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          reason: "bridge_error",
          failedIndex: index,
          detail,
          completedBeforeFailure: index,
          total,
        };
      }

      const completed = index + 1;
      const pct = progressPercentMilestone(completed, total);
      if (emitProgress && pct !== undefined) {
        try {
          await this.bridge.executeCommand(
            {
              kind: "say",
              message: `[Bot] Building… ${pct}% (${completed}/${total}).`,
            },
            {
              requestId: request.requestId,
              playerUuid: request.player.uuid,
              playerName: request.player.name,
            },
          );
        } catch {
          /* non-fatal */
        }
      }
    }

    return { ok: true };
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
