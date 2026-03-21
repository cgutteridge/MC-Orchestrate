import type { ChatProvider } from "../services/ai/types.js";
import { extractJsonValue, parseJsonStrict } from "../services/ai/json.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import { escapeRegex } from "../utils/regex.js";
import { normalizeBlockId, parseRequestedBlock } from "./materialPalette.js";
import type { PlannerLogger } from "./planLogger.js";
import { buildPlannerMessages } from "./prompt.js";
import {
  anchorPoint,
  defaultRegion,
  parseRequestedHeight,
  structureAnchorPoint,
} from "./requestContext.js";
import { PlanSchema, type Plan } from "./schema.js";

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
    case "cylinder": {
      const cylinderCenter = asPointRecord(
        record.center ?? parameters?.center,
      );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const BUILD_ACTION_TOKENS = [
  "build",
  "make",
  "create",
  "construct",
  "place",
];

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
  if (planAction === "unknown") {
    return false;
  }
  return requestAction !== planAction;
}

function containsKeyword(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) =>
    new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i").test(message),
  );
}

function classifyRequestAction(message: string): "build" | "remove" | "unknown" {
  const hasBuildAction = containsKeyword(message, BUILD_ACTION_TOKENS);
  const hasRemoveAction = containsKeyword(message, REMOVE_ACTION_TOKENS);
  if (hasBuildAction && !hasRemoveAction) {
    return "build";
  }
  if (hasRemoveAction && !hasBuildAction) {
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
          buildSignals += 1;
          break;
        case "clear_region":
          removeSignals += 1;
          break;
        case "replace_in_region":
          if (primitive.toBlock === "minecraft:air") {
            removeSignals += 1;
          } else {
            buildSignals += 1;
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

function normalizeIntentLabel(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (normalized.length === 0) {
    return undefined;
  }
  return normalized;
}

function asPointRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}
