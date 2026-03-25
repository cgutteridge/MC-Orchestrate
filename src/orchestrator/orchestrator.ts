import { describeBridgeCommand } from "../bridge/describeCommand.js";
import { BridgeServer } from "../bridge/bridgeServer.js";
import type { BridgeCommand } from "../bridge/types.js";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest, ChatCommandResponse } from "../types/plugin.js";
import { runPlacementThenBuild } from "../planner/aiPlanner.js";
import { compilePlanToBridgeCommands } from "../planner/compilePlan.js";
import type { PlacementBuildLogger } from "../planner/placementBuildLogger.js";
import type { PlannerLogger } from "../planner/planLogger.js";
import { sanitizePlanMaterials } from "../planner/materialResolver.js";
import {
  computePlacementAlignmentPoint,
  computePlanCenter,
  resolvePlacement,
  shiftPlan,
} from "../planner/placement.js";
import { validatePlanSemantics } from "../planner/semantics.js";
import type { Plan } from "../planner/schema.js";
import { WorldReader } from "../world/worldReader.js";
import { orchestratorUnexpectedErrorMessage } from "../planner/playerRefusalMessages.js";

/** Minimum bridge operations before mid-run percentage announcements. */
const PROGRESS_ANNOUNCE_MIN_OPS = 20;

/**
 * When {@link PROGRESS_ANNOUNCE_MIN_OPS} is met, returns 25 / 50 / 75 when
 * `completed` matches the first step count for that percentage (inclusive).
 */
function progressPercentMilestone(completed: number, total: number): 25 | 50 | 75 | undefined {
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
 * Coordinates chat requests, AI placement-then-build planning, semantic checks, and
 * bridge execution. Block ids are validated against the pinned vanilla registry;
 * invalid ids become stone and the player is notified.
 */
export class Orchestrator {
  private readonly recentMessagesByPlayer = new Map<string, string[]>();
  private readonly lastBuiltStructurePlanByPlayer = new Map<string, Plan>();
  constructor(
    private readonly bridge: BridgeServer,
    private readonly worldReader: WorldReader,
    private readonly provider?: ChatProvider,
    private readonly plannerLogger?: PlannerLogger,
    private readonly aiPlanMaxSteps: number = 10,
    private readonly planProgressLogger?: PlacementBuildLogger,
  ) {}

  /**
   * Handles a single in-game chat command from the plugin boundary.
   *
   * Immediately broadcasts a "Thinking…" acknowledgement so the player knows
   * the request was received. Then runs AI placement (location) and build planning,
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
        status: "rejected",
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
      // AI: get location (placement), then build the thing (plan)
      // -----------------------------------------------------------------------
      const planningResult = await runPlacementThenBuild(
        this.provider,
        planningRequest,
        this.worldReader,
        previousPlan,
        this.plannerLogger,
        this.bridge.getPlacedBlocks(),
        {
          signal,
          maxSteps: this.aiPlanMaxSteps,
          planProgressLogger: this.planProgressLogger,
        },
      );

      if (planningResult.outcome === "cancelled") {
        return {
          status: "error",
          reply: "Request was cancelled.",
          requestId: request.requestId,
          intent: "unknown",
          cancelled: true,
        };
      }

      if (planningResult.outcome === "rejected") {
        return {
          status: "rejected",
          reply: planningResult.reason,
          requestId: request.requestId,
          intent: "unknown",
        };
      }

      // Resolve the placement intent to a world-space anchor and reposition
      // the plan's centre to that anchor. Layer-map geometry (local layout) is
      // preserved; only the region anchor is shifted.
      // This is safe because the AI correctly expresses INTENT (verified via
      // the debug message below) but gets the look-vector rotation wrong when
      // computing absolute world coordinates itself.
      const lastBuiltPlan = this.lastBuiltStructurePlanByPlayer.get(request.player.uuid);
      const lastBuildCenter = lastBuiltPlan ? computePlanCenter(lastBuiltPlan) : undefined;
      const intentAnchor = resolvePlacement(
        planningResult.placement,
        planningRequest,
        lastBuildCenter,
      );
      const aiAlignment = computePlacementAlignmentPoint(
        planningResult.plan,
        planningResult.placement,
      );
      const reanchorOffset = {
        x: intentAnchor.x - aiAlignment.x,
        y: intentAnchor.y - aiAlignment.y,
        z: intentAnchor.z - aiAlignment.z,
      };

      // Broadcast the resolved placement so the player can verify it.
      try {
        await this.bridge.executeCommand(
          {
            kind: "say",
            message: `[Bot] Placement: ${describePlacement(planningResult.placement)} → world (${intentAnchor.x},${intentAnchor.y},${intentAnchor.z})`,
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

      let plan = shiftPlan(planningResult.plan, reanchorOffset);

      // -----------------------------------------------------------------------
      // Material validation (invalid ids → stone; always continue to semantics)
      // -----------------------------------------------------------------------
      const sanitized = sanitizePlanMaterials(plan);
      plan = sanitized.plan;
      if (sanitized.replacedIds.length > 0) {
        await this.notifyInvalidMaterialsReplaced(request, sanitized.replacedIds);
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

      // -----------------------------------------------------------------------
      // Execute the plan
      // -----------------------------------------------------------------------
      const commands = compilePlanToBridgeCommands(plan);
      const execution = await this.executeBridgeCommands(commands, request, signal, true);

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
        const detail = execution.detail;
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
      }

      return {
        status: "executed",
        reply: plan.reply,
        requestId: request.requestId,
        intent: plan.intent,
        executedActions: commands.length,
        briefFulfilment: plan.briefFulfilment,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
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
   * Logs invalid block ids that were substituted with stone and tells the player in-game.
   *
   * @param request Current chat request (for ids and bridge context).
   * @param replacedIds Distinct raw ids from the model that failed validation.
   */
  private async notifyInvalidMaterialsReplaced(
    request: ChatCommandRequest,
    replacedIds: string[],
  ): Promise<void> {
    if (replacedIds.length === 0) {
      return;
    }
    const detail = replacedIds.join(", ");
    await this.plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "material_sanitized",
      payload: { replacedIds },
    });
    await this.planProgressLogger?.line(
      request.requestId,
      -1,
      1,
      "material_sanitized",
      `replaced invalid ids with stone — ${detail}`,
    );
    const maxLen = 220;
    const truncated = detail.length <= maxLen ? detail : `${detail.slice(0, maxLen - 1)}…`;
    try {
      await this.bridge.executeCommand(
        {
          kind: "say",
          message: `[Bot] Invalid block id(s) in the plan were replaced with stone: ${truncated}`,
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
        const detail = error instanceof Error ? error.message : String(error);
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

  private rememberMessage(playerUuid: string, recentMessages: string[], message: string): void {
    const next = [...recentMessages, message.trim()].filter((entry) => entry.length > 0).slice(-10);
    this.recentMessagesByPlayer.set(playerUuid, next);
  }
}

/**
 * Formats a placement intent as a short human-readable string for in-game
 * debug output so the player can verify what the AI decided.
 *
 * Example: "player/player → F:10, UP:5"
 */
function describePlacement(p: import("../planner/schema.js").Placement): string {
  const meta: string[] = [];
  if (p.desiredSize) {
    meta.push(`size ${p.desiredSize.width}×${p.desiredSize.depth}×${p.desiredSize.height}`);
  }
  if (p.verticalReference && p.verticalReference !== "middle") {
    meta.push(`vertical:${p.verticalReference}`);
  }

  const offsets: string[] = [];
  if (p.frame === "player") {
    if (p.offset.F) offsets.push(`F:${p.offset.F}`);
    if (p.offset.R) offsets.push(`R:${p.offset.R}`);
  } else {
    if (p.offset.N) offsets.push(`N:${p.offset.N}`);
    if (p.offset.E) offsets.push(`E:${p.offset.E}`);
  }
  if (p.offset.UP) offsets.push(`UP:${p.offset.UP}`);

  const pieces = [...meta, ...offsets];
  const tail = pieces.length > 0 ? ` → ${pieces.join(", ")}` : " → at origin";
  return `${p.ref}/${p.frame}${tail}`;
}

/** True when at least one pass carries a layer map (what we execute as structure). */
function isBuiltStructurePlan(plan: Plan): boolean {
  return plan.passes.some((pass) => pass.layerMap !== undefined);
}
