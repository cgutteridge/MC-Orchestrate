import type { ChatProvider } from "../services/ai/types.js";
import { extractJsonValue, parseJsonStrict } from "../services/ai/json.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { PlannerLogger } from "./planLogger.js";
import { buildPlannerMessages } from "./prompt.js";
import {
  anchorPoint,
  defaultRegion,
  normalizeBlockId,
  parseRequestedBlock,
  parseRequestedHeight,
  structureAnchorPoint,
} from "./requestContext.js";
import { IntentSchema, PlanSchema, type Intent, type Plan } from "./schema.js";

/**
 * Builds a validated plan from an LLM response, repairing minor schema omissions when possible.
 */
export async function buildAiPlan(
  provider: ChatProvider,
  request: ChatCommandRequest,
  plannerLogger?: PlannerLogger,
): Promise<Plan> {
  const response = await provider.chat(buildPlannerMessages(request), {
    temperature: 0.1,
  });
  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "raw_response",
    payload: {
      provider: provider.name,
      response,
    },
  });
  const jsonText = extractJsonValue(response);
  if (!jsonText) {
    await plannerLogger?.log({
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      stage: "json_missing",
      payload: { response },
    });
    throw new Error("Planner returned no JSON.");
  }
  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "json_extracted",
    payload: { jsonText },
  });
  const loosePlan = parseJsonStrict<Record<string, unknown>>(jsonText);
  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "json_parsed",
    payload: loosePlan,
  });
  const repairedPlan = repairLoosePlanCandidate(loosePlan, request);
  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "plan_repaired",
    payload: repairedPlan,
  });
  const validatedPlan = PlanSchema.parse(repairedPlan);
  await plannerLogger?.log({
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
    stage: "plan_validated",
    payload: validatedPlan,
  });
  return validatedPlan;
}

function repairLoosePlanCandidate(
  candidate: Record<string, unknown>,
  request: ChatCommandRequest,
): Record<string, unknown> {
  const candidatePasses = Array.isArray(candidate.passes)
    ? candidate.passes.map((pass) => repairPass(pass, request))
        .filter(
          (pass) =>
            Array.isArray(pass.primitives) && pass.primitives.length > 0,
        )
    : [];
  let clarification =
    typeof candidate.clarification === "string"
      ? candidate.clarification
      : undefined;
  const rawIntent =
    IntentSchema.safeParse(candidate.intent).success
      ? (candidate.intent as Intent)
      : "unknown";
  let needsMoreInfo =
    candidate.needsMoreInfo === true || candidatePasses.length === 0;

  if (!needsMoreInfo && shouldClarifyIntent(rawIntent, request)) {
    needsMoreInfo = true;
    clarification =
      "I can build a house, build a tower, or remove a tree. What would you like?";
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
  const passes = needsMoreInfo ? [] : candidatePasses;
  const intent = needsMoreInfo ? "unknown" : rawIntent;

  return {
    intent,
    targetWorld,
    targetRegion,
    assumptions: Array.isArray(candidate.assumptions) ? candidate.assumptions : [],
    passes,
    reply:
      typeof candidate.reply === "string"
        ? candidate.reply
        : "Working on it.",
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
        .map((primitive) => repairPrimitive(primitive, request))
        .filter((primitive): primitive is Record<string, unknown> => !!primitive)
    : [];

  return {
    name: typeof record.name === "string" ? record.name : "build_pass",
    goal: typeof record.goal === "string" ? record.goal : "Apply build primitives.",
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
    case "cylinder":
      if (
        !lowerMessage.includes("cylinder") &&
        !asPointRecord(record.center ?? parameters?.center) &&
        typeof (record.radius ?? parameters?.radius) !== "number" &&
        typeof (record.height ?? parameters?.height) !== "number"
      ) {
        return undefined;
      }
      return {
        type,
        center: asPointRecord(record.center ?? parameters?.center) ?? structureAnchor,
        radius: asInt(record.radius ?? parameters?.radius, 2),
        height: asInt(record.height ?? parameters?.height, height),
        block:
          typeof (record.block ?? parameters?.block) === "string"
            ? normalizeBlockId(String(record.block ?? parameters?.block))
            : block,
        hollow:
          typeof (record.hollow ?? parameters?.hollow) === "boolean"
            ? Boolean(record.hollow ?? parameters?.hollow)
            : request.message.toLowerCase().includes("hollow"),
        axis:
          record.axis === "x" || record.axis === "y" || record.axis === "z"
            ? record.axis
            : parameters?.axis === "x" ||
                parameters?.axis === "y" ||
                parameters?.axis === "z"
              ? parameters.axis
            : "y",
      };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const HOUSE_KEYWORDS = ["house", "cottage", "hut", "cabin", "home"];
const TOWER_KEYWORDS = ["tower", "pillar", "column", "spire"];
const TREE_KEYWORDS = ["tree", "trees", "log", "logs", "stump", "leaves"];

function shouldClarifyIntent(intent: Intent, request: ChatCommandRequest): boolean {
  if (intent === "unknown") {
    return false;
  }

  const context = [request.message, ...request.recentMessages].join(" ");
  const matches =
    intent === "build_house"
      ? containsKeyword(context, HOUSE_KEYWORDS)
      : intent === "build_tower"
        ? containsKeyword(context, TOWER_KEYWORDS)
        : intent === "remove_tree"
          ? containsKeyword(context, TREE_KEYWORDS)
          : false;

  return !matches;
}

function containsKeyword(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) =>
    new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i").test(message),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asPointRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}
