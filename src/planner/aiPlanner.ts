import type { ChatMessage } from "../services/ai/types.js";
import type { ChatProvider } from "../services/ai/types.js";
import { extractJsonValue, parseJsonStrict } from "../services/ai/json.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { BlockSample } from "../types/plugin.js";
import { escapeRegex } from "../utils/regex.js";
import { normalizeBlockId, parseRequestedBlock } from "./materialPalette.js";
import type { PlannerLogger } from "./planLogger.js";
import {
  appendVerifyFulfillment,
  appendViewRequestFulfillment,
  buildInitialMessages,
} from "./prompt.js";
import {
  anchorPoint,
  defaultRegion,
  parseRequestedHeight,
  structureAnchorPoint,
} from "./requestContext.js";
import {
  ViewRequestSchema,
  PlanSchema,
  type Plan,
  type Region,
} from "./schema.js";
import type { WorldReader } from "../world/worldReader.js";

/** Maximum number of AI loop iterations before giving up. */
const MAX_LOOP_TURNS = 5;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of a completed design loop.
 */
export type DesignLoopResult =
  | { outcome: "plan"; plan: Plan }
  | { outcome: "needs_more_info"; clarification: string };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Runs the multi-turn AI design loop for a single player request. Each turn
 * the AI may request a world view or return a build plan. The loop:
 *
 * 1. Sends the initial context to the AI.
 * 2. If the AI returns `view_request`, fulfils the scan (from the initial
 *    plugin payload or WorldReader disk reads) and loops.
 * 3. If the AI returns `build` or a bare Plan, repairs and validates it.
 * 4. Aborts with `needs_more_info` after {@link MAX_LOOP_TURNS} turns or two
 *    consecutive parse/validation failures.
 *
 * @param provider AI chat provider.
 * @param request The validated player request.
 * @param worldReader For pre-build view scans and post-build verify reads.
 * @param lastPlan The last successfully built plan for this player (follow-up context).
 * @param plannerLogger Optional structured logger for each loop stage.
 * @param placedBlocks Optional map of blocks placed by the bridge this session.
 */
export async function runDesignLoop(
  provider: ChatProvider,
  request: ChatCommandRequest,
  worldReader: WorldReader,
  lastPlan: Plan | undefined,
  plannerLogger?: PlannerLogger,
  placedBlocks?: ReadonlyMap<string, string>,
): Promise<DesignLoopResult> {
  const messages: ChatMessage[] = buildInitialMessages(request, lastPlan);
  let consecutiveParseFailures = 0;

  for (let turn = 0; turn < MAX_LOOP_TURNS; turn++) {
    const rawResponse = await provider.chat(messages, { temperature: 0.2 });

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "raw_response",
      payload: { provider: provider.name, turn, response: rawResponse },
    });

    const jsonText = extractJsonValue(rawResponse);
    if (!jsonText) {
      consecutiveParseFailures++;
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "json_missing",
        payload: { turn, response: rawResponse },
      });
      if (consecutiveParseFailures >= 2) {
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

    const looseParsed = parseJsonStrict<Record<string, unknown>>(jsonText);

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "json_parsed",
      payload: { turn, looseParsed },
    });

    // ------------------------------------------------------------------
    // Dispatch on action type
    // ------------------------------------------------------------------
    const action =
      typeof looseParsed.action === "string" ? looseParsed.action : undefined;

    // view_request — validate strictly, no repair.
    if (action === "view_request") {
      const viewResult = ViewRequestSchema.safeParse(looseParsed);
      if (!viewResult.success) {
        consecutiveParseFailures++;
        if (consecutiveParseFailures >= 2) {
          break;
        }
        messages.push(
          { role: "assistant", content: jsonText },
          {
            role: "user",
            content: `The view_request was invalid: ${viewResult.error.message.slice(0, 200)}. Ensure region has world/min/max and selfNotes is present.`,
          },
        );
        continue;
      }

      const { region, selfNotes } = viewResult.data;

      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "view_request",
        payload: { turn, region },
      });

      const blocks = await fulfillViewRequest(region, request, worldReader);

      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "view_fulfilled",
        payload: { turn, region, blockCount: blocks?.length ?? 0 },
      });

      appendViewRequestFulfillment(messages, jsonText, selfNotes, region, blocks);
      continue;
    }

    // build or bare Plan — extract plan candidate and repair.
    // "build" wraps the plan under looseParsed.plan; bare Plans are at the top level.
    const planCandidate: Record<string, unknown> =
      action === "build" && isRecord(looseParsed.plan)
        ? (looseParsed.plan as Record<string, unknown>)
        : looseParsed;

    const repairedPlan = repairLoosePlanCandidate(planCandidate, request);

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "plan_repaired",
      payload: { turn, repairedPlan },
    });

    const planResult = PlanSchema.safeParse(repairedPlan);
    if (!planResult.success) {
      consecutiveParseFailures++;
      await plannerLogger?.log({
        timestamp: new Date().toISOString(),
        requestId: request.requestId,
        stage: "plan_invalid",
        payload: { turn, error: planResult.error.message },
      });
      if (consecutiveParseFailures >= 2) {
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

    consecutiveParseFailures = 0;

    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "plan_validated",
      payload: { turn, validatedPlan: planResult.data },
    });

    return { outcome: "plan", plan: planResult.data };
  }

  return {
    outcome: "needs_more_info",
    clarification:
      "I wasn't able to produce a complete plan. Could you give me more detail about what you'd like built?",
  };
}

/**
 * Runs a single verify + optional polish turn after a build plan has been
 * executed. The orchestrator calls this when the AI's build step included a
 * `verifyRegion`. Returns a polish Plan when the AI requests changes, or
 * `undefined` when the AI is satisfied or on any error.
 *
 * @param provider AI chat provider.
 * @param request The original player request.
 * @param priorMessages The message history from the completed design loop.
 * @param priorJson The raw JSON the AI returned for the build step.
 * @param verifyRegion The region to inspect.
 * @param worldReader For disk-based reads when the region extends beyond placed blocks.
 * @param plannerLogger Optional structured logger.
 * @param placedBlocks In-memory blocks placed by the bridge this session.
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
): Promise<Plan | undefined> {
  const verifyBlocks = await resolveVerifyBlocks(
    verifyRegion,
    placedBlocks,
    worldReader,
  );

  if (!verifyBlocks || verifyBlocks.length === 0) {
    return undefined;
  }

  const messages = [...priorMessages];
  appendVerifyFulfillment(messages, priorJson, verifyRegion, verifyBlocks);

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
  const action =
    typeof looseParsed.action === "string" ? looseParsed.action : undefined;

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
  if (polishPlan.needsMoreInfo || polishPlan.passes.length === 0) {
    return undefined;
  }

  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "polish_validated",
    payload: { plan: polishPlan },
  });

  return polishPlan;
}

// ---------------------------------------------------------------------------
// View request fulfillment
// ---------------------------------------------------------------------------

/**
 * Resolves block data for an AI view_request. Prefers the initial plugin
 * payload (zero I/O) when the requested region falls within `initialScanRegion`,
 * then falls back to WorldReader disk reads.
 */
async function fulfillViewRequest(
  region: Region,
  request: ChatCommandRequest,
  worldReader: WorldReader,
): Promise<BlockSample[] | undefined> {
  const scan = request.initialScanRegion;
  if (
    scan &&
    region.min.x >= scan.minX &&
    region.min.y >= scan.minY &&
    region.min.z >= scan.minZ &&
    region.max.x <= scan.maxX &&
    region.max.y <= scan.maxY &&
    region.max.z <= scan.maxZ
  ) {
    return request.localContext.nearbyBlocks.filter(
      (b) =>
        b.x >= region.min.x &&
        b.x <= region.max.x &&
        b.y >= region.min.y &&
        b.y <= region.max.y &&
        b.z >= region.min.z &&
        b.z <= region.max.z,
    );
  }

  return worldReader.readRegionBlocks(region, request.player.world);
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
 * object. Applied to every Plan candidate before Zod validation. Returns a
 * record that should satisfy `PlanSchema`.
 */
export function repairLoosePlanCandidate(
  candidate: Record<string, unknown>,
  request: ChatCommandRequest,
): Record<string, unknown> {
  const candidatePasses = Array.isArray(candidate.passes)
    ? candidate.passes
        .map((pass) => repairPass(pass, request))
        .filter(
          (pass) =>
            Array.isArray(pass.primitives) && pass.primitives.length > 0,
        )
    : [];

  let clarification =
    typeof candidate.clarification === "string"
      ? candidate.clarification
      : undefined;

  const rawIntent = normalizeIntentLabel(candidate.intent) ?? "unknown";
  let needsMoreInfo =
    candidate.needsMoreInfo === true || candidatePasses.length === 0;

  if (!needsMoreInfo && shouldClarifyByAction(candidatePasses, request)) {
    needsMoreInfo = true;
    clarification =
      "I need a clearer action. Tell me whether you want to build, remove, or modify something.";
  }

  const targetWorld = needsMoreInfo
    ? request.player.world
    : typeof candidate.targetWorld === "string"
      ? candidate.targetWorld
      : request.player.world;

  const targetRegion = needsMoreInfo
    ? defaultRegion(request)
    : isRecord(candidate.targetRegion)
      ? candidate.targetRegion
      : defaultRegion(request);

  return {
    intent: needsMoreInfo ? "unknown" : rawIntent,
    targetWorld,
    targetRegion,
    assumptions: Array.isArray(candidate.assumptions) ? candidate.assumptions : [],
    passes: needsMoreInfo ? [] : candidatePasses,
    reply:
      typeof candidate.reply === "string" ? candidate.reply : "Working on it.",
    needsMoreInfo,
    clarification,
  };
}

function repairPass(
  pass: unknown,
  request: ChatCommandRequest,
): Record<string, unknown> {
  const record = isRecord(pass) ? pass : {};
  const primitives = Array.isArray(record.primitives)
    ? record.primitives
        .map((p) => repairPrimitive(p, request))
        .filter((p): p is Record<string, unknown> => !!p)
    : [];

  return {
    name: typeof record.name === "string" ? record.name : "build_pass",
    goal:
      typeof record.goal === "string" ? record.goal : "Apply build primitives.",
    primitives,
  };
}

function repairPrimitive(
  primitive: unknown,
  request: ChatCommandRequest,
): Record<string, unknown> | undefined {
  const record = isRecord(primitive) ? primitive : {};
  const parameters = isRecord(record.parameters) ? record.parameters : undefined;
  const type = typeof record.type === "string" ? record.type : undefined;
  const anchor = anchorPoint(request, 4);
  const structureAnchor = structureAnchorPoint(request, 4);
  const height = parseRequestedHeight(request.message) ?? 5;
  const block = normalizeBlockId(
    parseRequestedBlock(request.message) ?? "minecraft:stone",
  );
  const lowerMessage = request.message.toLowerCase();

  switch (type) {
    case "cylinder": {
      const cylinderCenter = asPointRecord(record.center ?? parameters?.center);
      const cylinderRadius = record.radius ?? parameters?.radius;
      const cylinderHeight = record.height ?? parameters?.height;
      const fullySpecified =
        cylinderCenter &&
        typeof cylinderRadius === "number" &&
        typeof cylinderHeight === "number";
      if (!lowerMessage.includes("cylinder") && !fullySpecified) {
        return undefined;
      }
      return {
        type,
        center: cylinderCenter ?? structureAnchor,
        radius: asInt(cylinderRadius, 2),
        height: asInt(cylinderHeight, height),
        block:
          typeof (record.block ?? parameters?.block) === "string"
            ? normalizeBlockId(String(record.block ?? parameters?.block))
            : block,
        hollow:
          typeof (record.hollow ?? parameters?.hollow) === "boolean"
            ? Boolean(record.hollow ?? parameters?.hollow)
            : lowerMessage.includes("hollow"),
        axis:
          record.axis === "x" || record.axis === "y" || record.axis === "z"
            ? record.axis
            : parameters?.axis === "x" ||
                parameters?.axis === "y" ||
                parameters?.axis === "z"
              ? parameters.axis
              : "y",
      };
    }
    case "fill_cuboid":
    case "hollow_cuboid":
    case "clear_region":
      if (
        !asPointRecord(record.from ?? parameters?.from ?? parameters?.min) ||
        !asPointRecord(record.to ?? parameters?.to ?? parameters?.max)
      ) {
        return undefined;
      }
      return {
        type,
        from: asPointRecord(record.from ?? parameters?.from ?? parameters?.min),
        to: asPointRecord(record.to ?? parameters?.to ?? parameters?.max),
        ...(type === "clear_region"
          ? {}
          : {
              block:
                typeof (record.block ?? parameters?.block) === "string"
                  ? normalizeBlockId(String(record.block ?? parameters?.block))
                  : block,
            }),
      };
    case "replace_in_region":
      if (
        !asPointRecord(record.from ?? parameters?.from ?? parameters?.min) ||
        !asPointRecord(record.to ?? parameters?.to ?? parameters?.max) ||
        typeof (record.fromBlock ?? parameters?.fromBlock) !== "string" ||
        typeof (record.toBlock ?? parameters?.toBlock) !== "string"
      ) {
        return undefined;
      }
      return {
        type,
        from: asPointRecord(record.from ?? parameters?.from ?? parameters?.min),
        to: asPointRecord(record.to ?? parameters?.to ?? parameters?.max),
        fromBlock: String(record.fromBlock ?? parameters?.fromBlock),
        toBlock: String(record.toBlock ?? parameters?.toBlock),
      };
    case "set_block":
      return {
        type,
        x: asInt(record.x, anchor.x),
        y: asInt(record.y, anchor.y),
        z: asInt(record.z, anchor.z),
        block:
          typeof record.block === "string"
            ? normalizeBlockId(record.block)
            : block,
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Action classification helpers
// ---------------------------------------------------------------------------

const BUILD_ACTION_TOKENS = ["build", "make", "create", "construct", "place"];
const REMOVE_ACTION_TOKENS = [
  "remove",
  "delete",
  "clear",
  "destroy",
  "chop",
  "cut",
];

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
  return keywords.some((keyword) =>
    new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i").test(message),
  );
}

function classifyRequestAction(
  message: string,
): "build" | "remove" | "unknown" {
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
  let removeSignals = 0;

  for (const pass of passes) {
    const primitives = Array.isArray(pass.primitives) ? pass.primitives : [];
    for (const primitive of primitives) {
      if (!isRecord(primitive) || typeof primitive.type !== "string") {
        continue;
      }
      switch (primitive.type) {
        case "set_block":
        case "fill_cuboid":
        case "hollow_cuboid":
        case "cylinder":
          buildSignals++;
          break;
        case "clear_region":
          removeSignals++;
          break;
        case "replace_in_region":
          if (primitive.toBlock === "minecraft:air") {
            removeSignals++;
          } else {
            buildSignals++;
          }
          break;
      }
    }
  }

  if (buildSignals > 0 && removeSignals === 0) {
    return "build";
  }
  if (removeSignals > 0 && buildSignals === 0) {
    return "remove";
  }
  return "unknown";
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function asPointRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}
