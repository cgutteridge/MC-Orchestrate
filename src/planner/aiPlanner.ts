import type { ChatProvider } from "../services/ai/types.js";
import { extractJsonValue, parseJsonStrict } from "../services/ai/json.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import { buildPlannerMessages } from "./prompt.js";
import {
  anchorPoint,
  defaultRegion,
  parseRequestedBlock,
  parseRequestedHeight,
} from "./requestContext.js";
import { IntentSchema, PlanSchema, type Plan } from "./schema.js";

export async function buildAiPlan(
  provider: ChatProvider,
  request: ChatCommandRequest,
): Promise<Plan> {
  const response = await provider.chat(buildPlannerMessages(request), {
    temperature: 0.1,
  });
  const jsonText = extractJsonValue(response);
  if (!jsonText) {
    throw new Error("Planner returned no JSON.");
  }
  const loosePlan = parseJsonStrict<Record<string, unknown>>(jsonText);
  return PlanSchema.parse(repairLoosePlanCandidate(loosePlan, request));
}

function repairLoosePlanCandidate(
  candidate: Record<string, unknown>,
  request: ChatCommandRequest,
): Record<string, unknown> {
  const targetWorld =
    typeof candidate.targetWorld === "string"
      ? candidate.targetWorld
      : request.player.world;
  const targetRegion =
    isRecord(candidate.targetRegion)
      ? candidate.targetRegion
      : defaultRegion(request);

  const passes = Array.isArray(candidate.passes)
    ? candidate.passes.map((pass) => repairPass(pass, request))
    : [];

  return {
    intent: IntentSchema.safeParse(candidate.intent).success
      ? candidate.intent
      : "unknown",
    targetWorld,
    targetRegion,
    assumptions: Array.isArray(candidate.assumptions) ? candidate.assumptions : [],
    passes,
    reply:
      typeof candidate.reply === "string"
        ? candidate.reply
        : "Working on it.",
    needsMoreInfo: candidate.needsMoreInfo === true,
    clarification:
      typeof candidate.clarification === "string"
        ? candidate.clarification
        : undefined,
  };
}

function repairPass(
  pass: unknown,
  request: ChatCommandRequest,
): Record<string, unknown> {
  const record = isRecord(pass) ? pass : {};
  const primitives = Array.isArray(record.primitives)
    ? record.primitives.map((primitive) => repairPrimitive(primitive, request))
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
): Record<string, unknown> {
  const record = isRecord(primitive) ? primitive : {};
  const type = typeof record.type === "string" ? record.type : "set_block";
  const anchor = anchorPoint(request, 2);
  const height = parseRequestedHeight(request.message) ?? 5;
  const block = parseRequestedBlock(request.message) ?? "minecraft:stone";

  switch (type) {
    case "cylinder":
      return {
        type,
        center: isRecord(record.center) ? record.center : anchor,
        radius: asInt(record.radius, 2),
        height: asInt(record.height, height),
        block: typeof record.block === "string" ? record.block : block,
        hollow:
          typeof record.hollow === "boolean"
            ? record.hollow
            : request.message.toLowerCase().includes("hollow"),
        axis:
          record.axis === "x" || record.axis === "y" || record.axis === "z"
            ? record.axis
            : "y",
      };
    case "fill_cuboid":
    case "hollow_cuboid":
    case "clear_region":
      return {
        type,
        from: isRecord(record.from) ? record.from : anchor,
        to:
          isRecord(record.to)
            ? record.to
            : { x: anchor.x + 4, y: anchor.y + 4, z: anchor.z + 4 },
        ...(type === "clear_region"
          ? {}
          : { block: typeof record.block === "string" ? record.block : block }),
      };
    case "replace_in_region":
      return {
        type,
        from: isRecord(record.from) ? record.from : anchor,
        to:
          isRecord(record.to)
            ? record.to
            : { x: anchor.x + 4, y: anchor.y + 4, z: anchor.z + 4 },
        fromBlock:
          typeof record.fromBlock === "string"
            ? record.fromBlock
            : "minecraft:oak_log",
        toBlock:
          typeof record.toBlock === "string"
            ? record.toBlock
            : "minecraft:air",
      };
    case "set_block":
    default:
      return {
        type: "set_block",
        x: asInt(record.x, anchor.x),
        y: asInt(record.y, anchor.y),
        z: asInt(record.z, anchor.z),
        block: typeof record.block === "string" ? record.block : block,
      };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : fallback;
}
