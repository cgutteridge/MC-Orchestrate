import type { ChatMessage } from "../services/ai/types.js";
import type { ChatProvider } from "../services/ai/types.js";
import { extractJsonValue, parseJsonStrict } from "../services/ai/json.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { BlockSample } from "../types/plugin.js";
import { escapeRegex } from "../utils/regex.js";
import type { PlacementBuildLogger } from "./placementBuildLogger.js";
import type { PlannerLogger } from "./planLogger.js";
import {
  appendVerifyFulfillment,
  buildPlacementPhaseMessages,
  resetMessagesForPlanPhase,
} from "./prompt.js";
import { defaultRegion } from "./requestContext.js";
import {
  PlacementChoiceStepSchema,
  PlanSchema,
  PlacementSchema,
  type Plan,
  type Placement,
  type Region,
} from "./schema.js";
import type { WorldReader } from "../world/worldReader.js";
import { aiPlanFailureMessage } from "./playerRefusalMessages.js";
import { deriveLayerMapLocalBounds } from "./layerMap.js";

/** Default when {@link PlacementThenBuildOptions.maxSteps} is omitted (orchestrator passes config). */
export const DEFAULT_AI_PLAN_MAX_STEPS = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of placement-then-build planning: (1) lock location and size, (2) emit a plan.
 *
 * When `outcome` is `"plan"`, `placement` carries the semantic anchor+offset
 * the AI specified. The orchestrator resolves this to a world-space point and
 * shifts all primitive coordinates before validation and execution.
 *
 * `rejected` is returned when the step budget is exhausted or the assistant
 * fails twice in a row; `reason` is player-facing text for the HTTP response.
 *
 * `cancelled` is returned when {@link PlacementThenBuildOptions.signal} aborts before a
 * valid plan is produced.
 */
export type PlacementThenBuildResult =
  | { outcome: "plan"; plan: Plan; placement: Placement }
  | { outcome: "rejected"; reason: string }
  | { outcome: "cancelled" };

/** Optional controls for {@link runPlacementThenBuild} (e.g. HTTP client disconnect). */
export type PlacementThenBuildOptions = {
  signal?: AbortSignal;
  /** Max AI calls including correction retries (clamped 1–50). Defaults to {@link DEFAULT_AI_PLAN_MAX_STEPS}. */
  maxSteps?: number;
  /** Plain-text progress log (e.g. `logs/ai-plan.log`). */
  planProgressLogger?: PlacementBuildLogger;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Two-step build for one player request: **get the location**, then **build the thing**.
 *
 * 1. **Location** — placement-phase prompt; the model returns `placement_choice`
 *    (locks placement, size, vertical anchor).
 * 2. **Build** — plan-phase prompt; the model returns `build` with a `plan` only;
 *    placement is merged from step 1.
 * 3. Repairs and validates the plan against {@link PlanSchema}.
 * 4. Returns `rejected` after too many AI calls or two consecutive parse/validation failures.
 *
 * @param provider AI chat provider.
 * @param request The validated player request.
 * @param worldReader Reserved for API symmetry with verify passes; this function does not read the world.
 * @param lastPlan The last successfully built plan for this player (follow-up context).
 * @param plannerLogger Optional structured logger for each stage.
 * @param placedBlocks Optional map of blocks placed by the bridge this session.
 * @param options Optional abort signal, max AI steps, and text progress logger.
 */
export async function runPlacementThenBuild(
  provider: ChatProvider,
  request: ChatCommandRequest,
  _worldReader: WorldReader,
  lastPlan: Plan | undefined,
  plannerLogger?: PlannerLogger,
  placedBlocks?: ReadonlyMap<string, string>,
  options?: PlacementThenBuildOptions,
): Promise<PlacementThenBuildResult> {
  const maxSteps = clampAiPlanMaxSteps(options?.maxSteps ?? DEFAULT_AI_PLAN_MAX_STEPS);
  const dl = options?.planProgressLogger;

  const messages: ChatMessage[] = buildPlacementPhaseMessages(request, lastPlan);
  /** When set, placement was chosen in phase 1 and merged into the next build response. */
  let splitPlanPlacement: Placement | undefined;
  let consecutiveParseFailures = 0;
  /** Set when two assistant turns in a row could not yield a usable structured response. */
  let abortedAfterRepeatedAssistantErrors = false;

  await dl?.line(
    request.requestId,
    -1,
    maxSteps,
    "placement_then_build_start",
    `maxSteps=${maxSteps}; msg=${truncateOneLine(request.message)}`,
  );

  for (let step = 0; step < maxSteps; step++) {
    if (options?.signal?.aborted) {
      await dl?.line(request.requestId, step, maxSteps, "exit", "cancelled (signal)");
      return { outcome: "cancelled" };
    }

    await dl?.line(request.requestId, step, maxSteps, "call_start", "calling AI provider");

    const rawResponse = await provider.chat(messages, { temperature: 0.2 });

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "raw_response",
      payload: { provider: provider.name, step, response: rawResponse },
    });

    const jsonText = extractJsonValue(rawResponse);
    if (!jsonText) {
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "json_missing",
        "no JSON object in assistant reply",
      );
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "json_missing",
        payload: { step, response: rawResponse },
      });
      if (consecutiveParseFailures >= 2) {
        abortedAfterRepeatedAssistantErrors = true;
        break;
      }
      messages.push(
        { role: "assistant", content: rawResponse },
        {
          role: "user",
          content:
            "Your response did not contain a valid JSON object. Return only a JSON object — no markdown, no explanation.",
        },
      );
      continue;
    }

    consecutiveParseFailures = 0;

    let looseParsed: Record<string, unknown>;
    try {
      looseParsed = parseJsonStrict<Record<string, unknown>>(jsonText);
    } catch (err) {
      // The extracted JSON text was syntactically invalid (e.g. truncated or
      // escape-sequence error). Treat it the same as a missing JSON block.
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "json_parse_error",
        err instanceof Error ? err.message.slice(0, 120) : "parse error",
      );
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "json_parse_error",
        payload: { step, jsonText },
      });
      if (consecutiveParseFailures >= 2) {
        abortedAfterRepeatedAssistantErrors = true;
        break;
      }
      messages.push(
        { role: "assistant", content: rawResponse },
        {
          role: "user",
          content:
            "Your JSON was malformed and could not be parsed. Return only a single valid JSON object with no trailing commas, unescaped quotes, or truncation.",
        },
      );
      continue;
    }

    looseParsed = normalizeLooseDesignStepResponse(looseParsed);

    await dl?.line(request.requestId, step, maxSteps, "json_ok", summarizeLooseParsed(looseParsed));

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "json_parsed",
      payload: { step, looseParsed },
    });

    // ------------------------------------------------------------------
    // Dispatch on action type
    // ------------------------------------------------------------------
    const action = typeof looseParsed.action === "string" ? looseParsed.action : undefined;

    // placement_choice — phase 1 → phase 2 transition
    if (action === "placement_choice") {
      if (splitPlanPlacement) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "placement_choice_twice",
          "placement already locked",
        );
        if (consecutiveParseFailures >= 2) {
          abortedAfterRepeatedAssistantErrors = true;
          break;
        }
        messages.push(
          { role: "assistant", content: jsonText },
          {
            role: "user",
            content:
              'Placement is already locked. Return action: "build" with a "plan" field only (omit placement).',
          },
        );
        continue;
      }

      const pcResult = PlacementChoiceStepSchema.safeParse(looseParsed);
      if (!pcResult.success) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "placement_choice_invalid",
          pcResult.error.message.slice(0, 160),
        );
        if (consecutiveParseFailures >= 2) {
          abortedAfterRepeatedAssistantErrors = true;
          break;
        }
        messages.push(
          { role: "assistant", content: jsonText },
          {
            role: "user",
            content: `The placement_choice was invalid: ${pcResult.error.message.slice(0, 200)}. Ensure action is placement_choice, placement includes desiredSize (width, depth, height), verticalReference, ref, and offsets.`,
          },
        );
        continue;
      }

      const { placement: chosenPlacement, selfNotes } = pcResult.data;
      splitPlanPlacement = chosenPlacement;
      resetMessagesForPlanPhase(messages, request, chosenPlacement, lastPlan, selfNotes);
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "split_placement_locked",
        "transition to plan phase",
      );
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "split_placement_locked",
        payload: { step, placement: chosenPlacement },
      });
      consecutiveParseFailures = 0;
      continue;
    }

    // build rejected in phase 1 (placement-only)
    if (!splitPlanPlacement && action === "build") {
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "build_in_placement_phase",
        "expected placement_choice",
      );
      if (consecutiveParseFailures >= 2) {
        abortedAfterRepeatedAssistantErrors = true;
        break;
      }
      messages.push(
        { role: "assistant", content: jsonText },
        {
          role: "user",
          content:
            "This phase is placement only. Return placement_choice with a placement object — not a full plan yet.",
        },
      );
      continue;
    }

    // bare Plan (no action) rejected in placement phase
    if (!splitPlanPlacement && action !== "build") {
      const looksLikePlan =
        typeof looseParsed.intent === "string" || Array.isArray(looseParsed.passes);
      if (looksLikePlan) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "bare_plan_in_placement_phase",
          "expected placement_choice",
        );
        if (consecutiveParseFailures >= 2) {
          abortedAfterRepeatedAssistantErrors = true;
          break;
        }
        messages.push(
          { role: "assistant", content: jsonText },
          {
            role: "user",
            content:
              'This phase is placement only. Return JSON with action "placement_choice", not a full plan.',
          },
        );
        continue;
      }
    }

    if (action === "view_request") {
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "view_request_unsupported",
        "action not supported",
      );
      if (consecutiveParseFailures >= 2) {
        abortedAfterRepeatedAssistantErrors = true;
        break;
      }
      messages.push(
        { role: "assistant", content: jsonText },
        {
          role: "user",
          content:
            'The action "view_request" is not supported. Return action "placement_choice" on step 1, or action "build" with a plan after placement is locked.',
        },
      );
      continue;
    }

    // build or bare Plan — extract plan candidate and repair.
    // "build" wraps the plan under looseParsed.plan; bare Plans are at the top level.
    const planCandidate: Record<string, unknown> =
      action === "build" && isRecord(looseParsed.plan)
        ? (looseParsed.plan as Record<string, unknown>)
        : looseParsed;

    // Extract placement intent. Split loop phase 2 uses placement from phase 1.
    const rawPlacement = action === "build" ? looseParsed.placement : undefined;
    const placement = splitPlanPlacement
      ? splitPlanPlacement
      : PlacementSchema.catch(PlacementSchema.parse({})).parse(
          isRecord(rawPlacement) ? rawPlacement : {},
        );

    const repairedPlan = repairLoosePlanCandidate(planCandidate, request);

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "plan_repaired",
      payload: { step, placement, repairedPlan },
    });

    const planResult = PlanSchema.safeParse(repairedPlan);
    if (!planResult.success) {
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "plan_invalid",
        planResult.error.message.slice(0, 200),
      );
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "plan_invalid",
        payload: { step, error: planResult.error.message },
      });
      if (consecutiveParseFailures >= 2) {
        abortedAfterRepeatedAssistantErrors = true;
        break;
      }
      messages.push(
        { role: "assistant", content: jsonText },
        {
          role: "user",
          content: `The plan failed validation: ${planResult.error.message.slice(0, 300)}. Fix the plan and return a build response.`,
        },
      );
      continue;
    }

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "plan_validated",
      payload: { step, validatedPlan: planResult.data, placement },
    });

    await dl?.line(
      request.requestId,
      step,
      maxSteps,
      "success",
      "validated plan ready for execution",
    );

    return { outcome: "plan", plan: planResult.data, placement };
  }

  if (abortedAfterRepeatedAssistantErrors) {
    await dl?.line(
      request.requestId,
      -1,
      maxSteps,
      "exit",
      "rejected: repeated assistant or validation failures",
    );
    return {
      outcome: "rejected",
      reason: aiPlanFailureMessage("assistant_failed_twice", request),
    };
  }

  await dl?.line(request.requestId, -1, maxSteps, "exit", "rejected: max ai steps exhausted");
  return {
    outcome: "rejected",
    reason: aiPlanFailureMessage("max_steps", request),
  };
}

/**
 * Runs a single verify + optional polish pass after a build plan has been
 * executed. The orchestrator calls this when the AI's build step included a
 * `verifyRegion`. Returns a polish Plan when the AI requests changes, or
 * `undefined` when the AI is satisfied or on any error.
 *
 * @param provider AI chat provider.
 * @param request The original player request.
 * @param priorMessages The message history from completed placement-then-build planning.
 * @param priorJson The raw JSON the AI returned for the build step.
 * @param verifyRegion The region to inspect.
 * @param worldReader For disk-based reads when the region extends beyond placed blocks.
 * @param plannerLogger Optional structured logger.
 * @param placedBlocks In-memory blocks placed by the bridge this session.
 * @param options Optional abort signal (e.g. when the HTTP client disconnects).
 */
export async function runVerifyPass(
  provider: ChatProvider,
  request: ChatCommandRequest,
  priorMessages: ChatMessage[],
  priorJson: string,
  verifyRegion: Region,
  worldReader: WorldReader,
  plannerLogger?: PlannerLogger,
  placedBlocks?: ReadonlyMap<string, string>,
  options?: PlacementThenBuildOptions,
): Promise<Plan | undefined> {
  if (options?.signal?.aborted) {
    return undefined;
  }

  const verifyBlocks = await resolveVerifyBlocks(verifyRegion, placedBlocks, worldReader);

  if (!verifyBlocks || verifyBlocks.length === 0) {
    return undefined;
  }

  const messages = [...priorMessages];
  appendVerifyFulfillment(messages, priorJson, verifyRegion, verifyBlocks);

  if (options?.signal?.aborted) {
    return undefined;
  }

  const rawResponse = await provider.chat(messages, { temperature: 0.2 });

  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "verify_response",
    payload: { response: rawResponse },
  });

  const jsonText = extractJsonValue(rawResponse);
  if (!jsonText) {
    return undefined;
  }

  const looseParsed = parseJsonStrict<Record<string, unknown>>(jsonText);
  const action = typeof looseParsed.action === "string" ? looseParsed.action : undefined;

  const planCandidate: Record<string, unknown> =
    action === "build" && isRecord(looseParsed.plan)
      ? (looseParsed.plan as Record<string, unknown>)
      : looseParsed;

  const repairedPlan = repairLoosePlanCandidate(planCandidate, request);
  const planResult = PlanSchema.safeParse(repairedPlan);
  if (!planResult.success) {
    return undefined;
  }

  const polishPlan = planResult.data;

  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "polish_validated",
    payload: { plan: polishPlan },
  });

  return polishPlan;
}

/**
 * Resolves block data for a post-build verification region. Prefers blocks
 * already tracked in-memory by the bridge, falling back to disk reads for
 * blocks outside what we placed.
 */
async function resolveVerifyBlocks(
  region: Region,
  placedBlocks: ReadonlyMap<string, string> | undefined,
  worldReader: WorldReader,
): Promise<BlockSample[]> {
  const results: BlockSample[] = [];

  if (placedBlocks && placedBlocks.size > 0) {
    for (const [coordStr, blockType] of placedBlocks) {
      const parts = coordStr.split(" ");
      if (parts.length !== 3) {
        continue;
      }
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);
      if (
        x >= region.min.x &&
        x <= region.max.x &&
        y >= region.min.y &&
        y <= region.max.y &&
        z >= region.min.z &&
        z <= region.max.z
      ) {
        results.push({ x, y, z, type: blockType });
      }
    }
  }

  if (results.length === 0) {
    const diskBlocks = await worldReader.readRegionBlocks(region);
    if (diskBlocks) {
      results.push(...diskBlocks);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Plan repair — tolerates common LLM omissions before Zod validation
// ---------------------------------------------------------------------------

/**
 * Tolerates common LLM omissions and type mismatches in a loosely-parsed Plan
 * object. Applied to every Plan candidate before Zod validation.
 *
 * May set `passes` to an empty array when nothing executable remains or when
 * the plan's implied action mismatches the player's request — that fails
 * {@link PlanSchema} validation (`passes.min(1)`).
 */
export function repairLoosePlanCandidate(
  candidate: Record<string, unknown>,
  request: ChatCommandRequest,
): Record<string, unknown> {
  const candidatePasses = Array.isArray(candidate.passes)
    ? candidate.passes
        .map((pass) => repairPass(pass, request))
        .filter((pass) => {
          const hasLayer =
            isRecord(pass.layerMap) && Array.isArray((pass.layerMap as { layers: unknown }).layers);
          return hasLayer;
        })
    : [];

  const rawIntent = normalizeIntentLabel(candidate.intent) ?? "unknown";

  const targetWorld =
    typeof candidate.targetWorld === "string" ? candidate.targetWorld : request.player.world;

  let targetRegion: Record<string, unknown> = isRecord(candidate.targetRegion)
    ? candidate.targetRegion
    : defaultRegion(request);

  if (candidatePasses.length > 0 && !isRecord(candidate.targetRegion)) {
    const lmPass = candidatePasses.find(
      (p) => isRecord(p.layerMap) && Array.isArray((p.layerMap as { layers: unknown }).layers),
    );
    if (lmPass && isRecord(lmPass.layerMap)) {
      const bounds = deriveLayerMapLocalBounds(
        lmPass.layerMap as {
          layers: string[];
          palette: Record<string, string>;
        },
      );
      targetRegion = {
        world: targetWorld,
        min: bounds.min,
        max: bounds.max,
      };
    }
  }

  let passes = candidatePasses;
  if (passes.length === 0 || shouldClarifyByAction(candidatePasses, request)) {
    passes = [];
  }

  return {
    intent: rawIntent,
    targetWorld,
    targetRegion,
    assumptions: Array.isArray(candidate.assumptions) ? candidate.assumptions : [],
    passes,
    reply: typeof candidate.reply === "string" ? candidate.reply : "Working on it.",
  };
}

function repairPass(pass: unknown, _request: ChatCommandRequest): Record<string, unknown> {
  const record = isRecord(pass) ? pass : {};
  const layerRaw = record.layerMap;
  if (layerRaw && isRecord(layerRaw) && Array.isArray(layerRaw.layers)) {
    return {
      name: typeof record.name === "string" ? record.name : "build_pass",
      goal: typeof record.goal === "string" ? record.goal : "Apply layer map build.",
      primitives: [],
      layerMap: {
        layers: layerRaw.layers as string[],
        palette: (isRecord(layerRaw.palette) ? layerRaw.palette : {}) as Record<string, string>,
      },
    };
  }

  return {
    name: typeof record.name === "string" ? record.name : "build_pass",
    goal: typeof record.goal === "string" ? record.goal : "Apply layer map build.",
    primitives: [],
  };
}

// ---------------------------------------------------------------------------
// Action classification helpers
// ---------------------------------------------------------------------------

const BUILD_ACTION_TOKENS = ["build", "make", "create", "construct", "place"];
const REMOVE_ACTION_TOKENS = ["remove", "delete", "clear", "destroy", "chop", "cut"];

function shouldClarifyByAction(
  passes: Array<Record<string, unknown>>,
  request: ChatCommandRequest,
): boolean {
  const context = [request.message, ...request.recentMessages].join(" ");
  const requestAction = classifyRequestAction(context);
  if (requestAction === "unknown") {
    return false;
  }
  const planAction = classifyPlanAction(passes);
  return planAction !== "unknown" && requestAction !== planAction;
}

function containsKeyword(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i").test(message));
}

function classifyRequestAction(message: string): "build" | "remove" | "unknown" {
  const hasBuild = containsKeyword(message, BUILD_ACTION_TOKENS);
  const hasRemove = containsKeyword(message, REMOVE_ACTION_TOKENS);
  if (hasBuild && !hasRemove) {
    return "build";
  }
  if (hasRemove && !hasBuild) {
    return "remove";
  }
  return "unknown";
}

function classifyPlanAction(
  passes: Array<Record<string, unknown>>,
): "build" | "remove" | "unknown" {
  let buildSignals = 0;
  for (const pass of passes) {
    if (isRecord(pass.layerMap)) {
      buildSignals++;
    }
  }
  if (buildSignals > 0) {
    return "build";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Unwraps mistaken nested `{ placement_choice: { action, placement } }` replies
 * and coerces string `placement` values from legacy prompt shapes into objects.
 *
 * @param loose Parsed top-level JSON from the assistant.
 * @returns Possibly rewritten object for schema dispatch.
 */
function normalizeLooseDesignStepResponse(loose: Record<string, unknown>): Record<string, unknown> {
  let out = loose;
  const nested = loose.placement_choice;
  if (isRecord(nested) && nested.action === "placement_choice") {
    out = { ...nested } as Record<string, unknown>;
  }
  const pl = out.placement;
  if (typeof pl === "string") {
    const coerced = coercePlacementFromModelString(pl);
    if (coerced) {
      out = { ...out, placement: coerced };
    }
  }
  return out;
}

/**
 * Parses pseudo-JSON placement strings such as `{ ref:player_view, forward:8 }`.
 *
 * @param s Raw `placement` string from the model.
 * @returns A record suitable for {@link PlacementSchema} parsing, or `undefined`.
 */
function coercePlacementFromModelString(s: string): Record<string, unknown> | undefined {
  const trimmed = s.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isRecord(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through — model often omits quotes (invalid JSON)
    }
  }
  const inner = trimmed.replace(/^\{/, "").replace(/\}$/, "").trim();
  const out: Record<string, unknown> = {};
  const refM = inner.match(/\bref\s*:\s*([a-z_]+)/i);
  if (refM) {
    out.ref = refM[1];
  }
  for (const key of [
    "forward",
    "back",
    "left",
    "right",
    "north",
    "south",
    "east",
    "west",
    "up",
    "down",
  ] as const) {
    const km = inner.match(new RegExp(`\\b${key}\\s*:\\s*(-?\\d+)`));
    if (km) {
      out[key] = Number(km[1]);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function clampAiPlanMaxSteps(n: number): number {
  return Math.min(50, Math.max(1, Math.round(n)));
}

function truncateOneLine(s: string, max = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function summarizeLooseParsed(loose: Record<string, unknown>): string {
  const action = typeof loose.action === "string" ? loose.action : undefined;
  if (action === "placement_choice") {
    return "action=placement_choice";
  }
  if (action === "build") {
    return "action=build";
  }
  if (typeof loose.intent === "string" || Array.isArray(loose.passes)) {
    return "bare_plan";
  }
  return "unknown_shape";
}

function normalizeIntentLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length === 0 ? undefined : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
