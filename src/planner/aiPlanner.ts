import type { ChatMessage } from "../services/ai/types.js";
import type { ChatProvider } from "../services/ai/types.js";
import { extractJsonValue, parseJsonStrict } from "../services/ai/json.js";
import type { BlockSample, ChatCommandRequest } from "../types/plugin.js";
import { escapeRegex } from "../utils/regex.js";
import type { PlacementBuildLogger } from "./placementBuildLogger.js";
import type { PlannerLogger } from "./planLogger.js";
import {
  composePlacementPhaseMessages,
  resetMessagesForDesignPhase,
  resetMessagesForLayerMapPhase,
} from "./prompt.js";
import { resolvePlacement } from "./placement.js";
import { defaultRegion } from "./requestContext.js";
import {
  DesignChoiceStepSchema,
  PlacementChoiceStepSchema,
  PlacementPositionOnlySchema,
  PlanSchema,
  type DesignChoiceStep,
  type Plan,
  type Placement,
  type PlacementPositionOnly,
  type Region,
} from "./schema.js";
import { aiPlanFailureMessage } from "./playerRefusalMessages.js";
import {
  coerceAssistantLayerMapToLoosePlanCandidate,
  deriveLayerMapLocalBounds,
  looksLikeBareLayerMapPayload,
  normalizeLayerMap,
  type LayerMapClip,
} from "./layerMap.js";
import {
  computeTargetRegionFromPlacement,
  expandRegion,
  serializeRegionBlocksToLayerMap,
} from "./worldContext.js";

/** Default when {@link PlacementThenBuildOptions.maxSteps} is omitted (orchestrator passes config). */
const DEFAULT_AI_PLAN_MAX_STEPS = 10;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of placement-then-build planning: (1) lock location and size, (2) emit a plan.
 *
 * When `outcome` is `"plan"`, `placement` carries the semantic anchor+offset
 * the AI specified. The orchestrator resolves this to a world-space point and
 * shifts the plan's region before validation and execution.
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
  /** Optional world scan callback used to load expanded build context from region files. */
  readRegionBlocks?: (region: Region, worldName: string) => Promise<BlockSample[] | undefined>;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Three-step build: **position** → **design** (materials + size + prose) → **layer map**.
 *
 * 1. **Placement** — position intent (anchor only; no size).
 * 2. **Design** — `design_choice` (only step with full material-registry context).
 * 3. **Build** — model returns only `layers` + `palette` (or legacy `action`/`plan`/`passes`); server merges placement from step 1 with size from step 2.
 * 4. Repairs and validates the plan against {@link PlanSchema}.
 * 5. Returns `rejected` after too many AI calls or two consecutive parse/validation failures.
 *
 * @param provider AI chat provider.
 * @param request The validated player request.
 * @param lastPlan The last successfully built plan for this player (follow-up context).
 * @param plannerLogger Optional structured logger for each stage.
 * @param placedBlocks Optional map of blocks placed by the bridge this session.
 * @param options Optional abort signal, max AI steps, and text progress logger.
 */
export async function runPlacementThenBuild(
  provider: ChatProvider,
  request: ChatCommandRequest,
  lastPlan: Plan | undefined,
  plannerLogger?: PlannerLogger,
  _placedBlocks?: ReadonlyMap<string, string>,
  options?: PlacementThenBuildOptions,
): Promise<PlacementThenBuildResult> {
  const maxSteps = clampAiPlanMaxSteps(options?.maxSteps ?? DEFAULT_AI_PLAN_MAX_STEPS);
  const dl = options?.planProgressLogger;

  const messages: ChatMessage[] = composePlacementPhaseMessages(request, lastPlan);
  /** Position-only placement from step 1 (no `desiredSize`). */
  let splitPlanPlacement: PlacementPositionOnly | undefined;
  /** Design step output: size + materials + prose for the builder. */
  let lockedDesign: DesignChoiceStep | undefined;
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
    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "prompt_messages",
      payload: {
        provider: provider.name,
        step,
        options: { temperature: 0.2 },
        messages: messages.map((message) => ({ ...message })),
      },
    });

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
    const placementCandidate = parsePlacementPositionOnly(looseParsed);

    if (!splitPlanPlacement && !lockedDesign && placementCandidate !== undefined) {
      splitPlanPlacement = placementCandidate;
      resetMessagesForDesignPhase(messages, request, lastPlan);
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "split_placement_locked",
        "transition to design phase",
      );
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "split_placement_locked",
        payload: { step, placement: placementCandidate },
      });
      consecutiveParseFailures = 0;
      continue;
    }

    // placement_choice — phase 1 → design phase
    if (action === "placement_choice") {
      if (lockedDesign) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "placement_choice_after_design",
          "expected build",
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
              'Placement and design are locked. Return only a JSON object with "layers" and "palette" for the layer map (omit placement).',
          },
        );
        continue;
      }
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
              'Placement is already locked. Return action: "design_choice" with designSummary, builderGuide, desiredSize, and recommendedMaterials — not placement again.',
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
            content: `Placement was invalid: ${pcResult.error.message.slice(0, 200)}. Return placement intent as {ref, frame, offset}; no size and no action wrapper.`,
          },
        );
        continue;
      }

      const chosenPlacement = pcResult.data.placement;
      splitPlanPlacement = chosenPlacement;
      resetMessagesForDesignPhase(messages, request, lastPlan);
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "split_placement_locked",
        "transition to design phase",
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

    // design_choice — phase 2 → layer-map phase
    if (action === "design_choice") {
      if (!splitPlanPlacement) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "design_choice_without_placement",
          "expected placement first",
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
              "Return placement intent first as {ref, frame, offset}. You cannot output design_choice before placement is locked.",
          },
        );
        continue;
      }
      if (lockedDesign) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "design_choice_twice",
          "design already locked",
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
              'Design is already locked. Return only JSON with "layers" and "palette" for the layer map.',
          },
        );
        continue;
      }

      const dResult = DesignChoiceStepSchema.safeParse(looseParsed);
      if (!dResult.success) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "design_choice_invalid",
          dResult.error.message.slice(0, 160),
        );
        if (consecutiveParseFailures >= 2) {
          abortedAfterRepeatedAssistantErrors = true;
          break;
        }
        messages.push(
          { role: "assistant", content: jsonText },
          {
            role: "user",
            content: `The design_choice was invalid: ${dResult.error.message.slice(0, 200)}. Ensure designSummary, builderGuide, desiredSize, and recommendedMaterials (vanilla minecraft: ids).`,
          },
        );
        continue;
      }

      lockedDesign = dResult.data;
      const mergedPlacement = mergePlacementWithDesign(splitPlanPlacement, lockedDesign);
      const existingWorldContext = await loadExistingWorldContext(
        request,
        mergedPlacement,
        options?.readRegionBlocks,
        plannerLogger,
        dl,
        step,
        maxSteps,
      );
      resetMessagesForLayerMapPhase(
        messages,
        request,
        mergedPlacement,
        lockedDesign,
        existingWorldContext,
      );
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "split_design_locked",
        "transition to layer_map phase",
      );
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "split_design_locked",
        payload: { step, design: lockedDesign, mergedPlacement },
      });
      consecutiveParseFailures = 0;
      continue;
    }

    // build rejected before placement
    if (!splitPlanPlacement && action === "build") {
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "build_in_placement_phase",
        "expected placement",
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
            "This phase is placement only. Return placement intent as {ref, frame, offset} — not a full plan yet.",
        },
      );
      continue;
    }

    // build rejected before design
    if (splitPlanPlacement && !lockedDesign && action === "build") {
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "build_in_design_phase",
        "expected design_choice",
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
            "This phase is design only. Return design_choice with designSummary, builderGuide, desiredSize, and recommendedMaterials — not a full plan yet.",
        },
      );
      continue;
    }

    // bare Plan (no action) rejected in placement or design phase
    if ((!splitPlanPlacement || !lockedDesign) && action !== "build") {
      const looksLikePlan =
        typeof looseParsed.intent === "string" ||
        Array.isArray(looseParsed.passes) ||
        looksLikeBareLayerMapPayload(looseParsed);
      if (looksLikePlan) {
        consecutiveParseFailures++;
        await dl?.line(
          request.requestId,
          step,
          maxSteps,
          "bare_plan_in_early_phase",
          !splitPlanPlacement ? "expected placement" : "expected design_choice",
        );
        if (consecutiveParseFailures >= 2) {
          abortedAfterRepeatedAssistantErrors = true;
          break;
        }
        const expected = !splitPlanPlacement
          ? "Return placement intent JSON {ref, frame, offset}, not a full plan."
          : 'Return JSON with action "design_choice", not a full plan.';
        messages.push(
          { role: "assistant", content: jsonText },
          { role: "user", content: expected },
        );
        continue;
      }
    }

    if (!splitPlanPlacement || !lockedDesign) {
      consecutiveParseFailures++;
      await dl?.line(
        request.requestId,
        step,
        maxSteps,
        "unexpected_shape",
        "expected placement then design then build",
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
            "Expected placement intent, then design_choice, then build with a plan. Return the correct schema for this phase.",
        },
      );
      continue;
    }

    // build or bare Plan — extract plan candidate and repair.
    // Legacy: `action: "build"` + `plan`; bare Plans at top level; step 3 may return only `layers` + `palette`.
    let planCandidate: Record<string, unknown> =
      action === "build" && isRecord(looseParsed.plan)
        ? (looseParsed.plan as Record<string, unknown>)
        : looseParsed;

    planCandidate = coerceAssistantLayerMapToLoosePlanCandidate(planCandidate);

    const mergedPlacement = mergePlacementWithDesign(splitPlanPlacement, lockedDesign);

    const repairedPlan = repairLoosePlanCandidate(planCandidate, request);
    const sizedPlan = applyDesiredSizeToPlanCandidate(repairedPlan, lockedDesign.desiredSize);

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "plan_repaired",
      payload: { step, placement: mergedPlacement, repairedPlan, sizedPlan },
    });

    const planResult = PlanSchema.safeParse(sizedPlan);
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
          content: `The plan failed validation: ${planResult.error.message.slice(0, 300)}. Fix the layer map JSON (layers + palette only).`,
        },
      );
      continue;
    }

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "plan_validated",
      payload: { step, validatedPlan: planResult.data, placement: mergedPlacement },
    });

    await dl?.line(
      request.requestId,
      step,
      maxSteps,
      "success",
      "validated plan ready for execution",
    );

    return { outcome: "plan", plan: planResult.data, placement: mergedPlacement };
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

async function loadExistingWorldContext(
  request: ChatCommandRequest,
  mergedPlacement: Placement,
  readRegionBlocks:
    | ((region: Region, worldName: string) => Promise<BlockSample[] | undefined>)
    | undefined,
  plannerLogger: PlannerLogger | undefined,
  dl: PlacementBuildLogger | undefined,
  step: number,
  maxSteps: number,
): Promise<{ layers: string[]; palette: Record<string, string> } | undefined> {
  if (!readRegionBlocks || !mergedPlacement.desiredSize) {
    return undefined;
  }

  try {
    const anchor = resolvePlacement(mergedPlacement, request, undefined);
    const targetRegion = computeTargetRegionFromPlacement(
      anchor,
      mergedPlacement,
      request.player.world,
    );
    const contextRegion = expandRegion(targetRegion, 2);

    await dl?.line(
      request.requestId,
      step,
      maxSteps,
      "context_scan_start",
      `scan min(${contextRegion.min.x},${contextRegion.min.y},${contextRegion.min.z}) max(${contextRegion.max.x},${contextRegion.max.y},${contextRegion.max.z})`,
    );
    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "context_scan_start",
      payload: { step, contextRegion },
    });

    const blocks = await readRegionBlocks(contextRegion, request.player.world);
    if (!blocks) {
      await dl?.line(request.requestId, step, maxSteps, "context_scan_unavailable", "scan failed");
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "context_scan_unavailable",
        payload: { step, contextRegion, reason: "scan failed" },
      });
      return undefined;
    }

    await dl?.line(
      request.requestId,
      step,
      maxSteps,
      "context_scan_ready",
      `loaded ${blocks.length} non-air blocks`,
    );
    const layerMap = serializeRegionBlocksToLayerMap(contextRegion, blocks);
    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "context_scan_ready",
      payload: {
        step,
        contextRegion,
        nonAirBlockCount: blocks.length,
        layerCount: layerMap.layers.length,
        paletteSize: Object.keys(layerMap.palette).length,
      },
    });
    return layerMap;
  } catch {
    await dl?.line(
      request.requestId,
      step,
      maxSteps,
      "context_scan_unavailable",
      "scan threw unexpectedly",
    );
    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "context_scan_unavailable",
      payload: { step, reason: "scan threw unexpectedly" },
    });
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Plan repair — tolerates common LLM omissions before Zod validation
// ---------------------------------------------------------------------------

/**
 * Rectangularizes and clips each pass layer map to the design-step footprint so
 * normalization matches {@link lockedDesign.desiredSize}, not arbitrary caps.
 *
 * @param candidate - Output of {@link repairLoosePlanCandidate}.
 * @param desiredSize - Locked width × depth × height from `design_choice`.
 */
function applyDesiredSizeToPlanCandidate(
  candidate: Record<string, unknown>,
  desiredSize: { width: number; depth: number; height: number },
): Record<string, unknown> {
  const passes = candidate.passes;
  if (!Array.isArray(passes)) {
    return candidate;
  }
  const clip: LayerMapClip = {
    width: desiredSize.width,
    depth: desiredSize.depth,
    height: desiredSize.height,
  };
  const nextPasses = passes.map((pass) => {
    if (
      !isRecord(pass) ||
      !isRecord(pass.layerMap) ||
      !Array.isArray((pass.layerMap as { layers: unknown }).layers)
    ) {
      return pass;
    }
    const lm = pass.layerMap as { layers: string[]; palette: Record<string, string> };
    return {
      ...pass,
      layerMap: normalizeLayerMap(lm, clip),
    };
  });
  return { ...candidate, passes: nextPasses };
}

/**
 * Tolerates common LLM omissions and type mismatches in a loosely-parsed Plan
 * object. Applied to every Plan candidate before Zod validation.
 *
 * May set `passes` to an empty array when nothing executable remains or when
 * the plan's implied action mismatches the player's request — that fails
 * {@link PlanSchema} validation (`passes.min(1)`).
 */
function repairLoosePlanCandidate(
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

  const reply = typeof candidate.reply === "string" ? candidate.reply : "Working on it.";
  const briefRaw = candidate.briefFulfilment;
  const briefFulfilment =
    typeof briefRaw === "string" && briefRaw.trim().length > 0
      ? briefRaw.trim().slice(0, 2000)
      : undefined;

  return {
    intent: rawIntent,
    targetWorld,
    targetRegion,
    assumptions: Array.isArray(candidate.assumptions) ? candidate.assumptions : [],
    passes,
    reply,
    ...(briefFulfilment !== undefined ? { briefFulfilment } : {}),
  };
}

function repairPass(pass: unknown, _request: ChatCommandRequest): Record<string, unknown> {
  const record = isRecord(pass) ? pass : {};
  const layerRaw = record.layerMap;
  if (layerRaw && isRecord(layerRaw) && Array.isArray(layerRaw.layers)) {
    return {
      name: typeof record.name === "string" ? record.name : "build_pass",
      goal: typeof record.goal === "string" ? record.goal : "Apply layer map build.",
      layerMap: {
        layers: layerRaw.layers as string[],
        palette: (isRecord(layerRaw.palette) ? layerRaw.palette : {}) as Record<string, string>,
      },
    };
  }

  return {
    name: typeof record.name === "string" ? record.name : "build_pass",
    goal: typeof record.goal === "string" ? record.goal : "Apply layer map build.",
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
  const context = [request.message, ...(request.recentMessages ?? [])].join(" ");
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
 * Accepts either direct placement JSON (`{ref,frame,offset}`) or legacy
 * wrapped shape (`{action:"placement_choice", placement:{...}}`).
 */
function parsePlacementPositionOnly(
  loose: Record<string, unknown>,
): PlacementPositionOnly | undefined {
  if (looksLikePlacementRecord(loose)) {
    const direct = PlacementPositionOnlySchema.safeParse(normalizeLegacyPlacementObject(loose));
    if (direct.success) {
      return direct.data;
    }
  }
  const wrapped = PlacementChoiceStepSchema.safeParse(loose);
  if (wrapped.success) {
    return wrapped.data.placement;
  }
  const nestedPlacement = loose.placement;
  if (isRecord(nestedPlacement)) {
    const nested = PlacementPositionOnlySchema.safeParse(
      normalizeLegacyPlacementObject(nestedPlacement),
    );
    if (nested.success) {
      return nested.data;
    }
  }
  return undefined;
}

function looksLikePlacementRecord(input: Record<string, unknown>): boolean {
  for (const key of [
    "ref",
    "frame",
    "offset",
    "F",
    "R",
    "N",
    "E",
    "UP",
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
    if (key in input) {
      return true;
    }
  }
  return false;
}

/**
 * Converts legacy placement keys (`player_view`, `forward`, `north`, `up`...)
 * into the signed-axis shape used by {@link PlacementPositionOnlySchema}.
 */
function normalizeLegacyPlacementObject(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  const offset: Record<string, number> = {};
  if (isRecord(input.offset)) {
    for (const k of ["F", "R", "N", "E", "UP"] as const) {
      if (typeof input.offset[k] === "number") {
        offset[k] = Math.round(input.offset[k] as number);
      }
    }
  }
  const read = (k: string): number | undefined =>
    typeof input[k] === "number" ? Math.round(input[k] as number) : undefined;
  const forward = read("forward") ?? 0;
  const back = read("back") ?? 0;
  const right = read("right") ?? 0;
  const left = read("left") ?? 0;
  const north = read("north") ?? 0;
  const south = read("south") ?? 0;
  const east = read("east") ?? 0;
  const west = read("west") ?? 0;
  const up = read("up") ?? 0;
  const down = read("down") ?? 0;

  if (forward || back || right || left) {
    offset.F = (offset.F ?? 0) + forward - back;
    offset.R = (offset.R ?? 0) + right - left;
  }
  if (north || south || east || west) {
    offset.N = (offset.N ?? 0) + north - south;
    offset.E = (offset.E ?? 0) + east - west;
  }
  if (up || down) {
    offset.UP = (offset.UP ?? 0) + up - down;
  }

  if (Object.keys(offset).length > 0) {
    out.offset = offset;
  }

  const rawRef = typeof input.ref === "string" ? input.ref : undefined;
  if (rawRef === "player_view" || rawRef === "player_absolute" || rawRef === "last_build") {
    out.ref = "player";
  }
  if (rawRef === "focus") {
    out.ref = "focus";
  }

  if (typeof input.frame !== "string") {
    if (forward || back || right || left) {
      out.frame = "player";
    } else if (north || south || east || west) {
      out.frame = "world";
    }
  }
  return out;
}

/**
 * Parses pseudo-JSON placement strings such as `{ ref:player, frame:player, offset:{F:10,R:0,UP:0} }`.
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
  const frameM = inner.match(/\bframe\s*:\s*([a-z_]+)/i);
  if (frameM) {
    out.frame = frameM[1];
  }
  const offset: Record<string, number> = {};
  for (const key of ["F", "R", "N", "E", "UP"] as const) {
    const km = inner.match(new RegExp(`\\b${key}\\s*:\\s*(-?\\d+)`, "i"));
    if (km) {
      offset[key] = Number(km[1]);
    }
  }
  // Legacy compatibility for partially quoted pseudo-JSON from older prompts.
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
      const n = Number(km[1]);
      if (key === "forward") offset.F = (offset.F ?? 0) + n;
      if (key === "back") offset.F = (offset.F ?? 0) - n;
      if (key === "right") offset.R = (offset.R ?? 0) + n;
      if (key === "left") offset.R = (offset.R ?? 0) - n;
      if (key === "north") offset.N = (offset.N ?? 0) + n;
      if (key === "south") offset.N = (offset.N ?? 0) - n;
      if (key === "east") offset.E = (offset.E ?? 0) + n;
      if (key === "west") offset.E = (offset.E ?? 0) - n;
      if (key === "up") offset.UP = (offset.UP ?? 0) + n;
      if (key === "down") offset.UP = (offset.UP ?? 0) - n;
    }
  }
  if (Object.keys(offset).length > 0) {
    out.offset = offset;
  }
  if (out.frame === undefined && (offset.F !== undefined || offset.R !== undefined)) {
    out.frame = "player";
  }
  if (out.frame === undefined && (offset.N !== undefined || offset.E !== undefined)) {
    out.frame = "world";
  }
  if (out.ref === "player_view" || out.ref === "player_absolute" || out.ref === "last_build") {
    out.ref = "player";
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

/**
 * Merges position-only placement with the design step's footprint and vertical reference.
 *
 * @param position Step-1 placement (no `desiredSize`).
 * @param design Validated design_choice.
 */
function mergePlacementWithDesign(
  position: PlacementPositionOnly,
  design: DesignChoiceStep,
): Placement {
  return {
    ...position,
    desiredSize: design.desiredSize,
    verticalReference: design.verticalReference,
  };
}

function summarizeLooseParsed(loose: Record<string, unknown>): string {
  if (parsePlacementPositionOnly(loose) !== undefined) {
    return "placement_only";
  }
  const action = typeof loose.action === "string" ? loose.action : undefined;
  if (action === "placement_choice") {
    return "action=placement_choice";
  }
  if (action === "design_choice") {
    return "action=design_choice";
  }
  if (action === "build") {
    return "action=build";
  }
  if (typeof loose.intent === "string" || Array.isArray(loose.passes)) {
    return "bare_plan";
  }
  if (looksLikeBareLayerMapPayload(loose)) {
    return "layer_map_only";
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
