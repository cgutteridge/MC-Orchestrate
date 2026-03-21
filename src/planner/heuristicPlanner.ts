import type { ChatCommandRequest } from "../types/plugin.js";
import {
  asBlock,
  normalizeRegion,
  parseRequestedBlock,
} from "./requestContext.js";
import { PlanSchema, type Plan } from "./schema.js";

/**
 * Returns a deterministic fallback plan for the small set of built-in v1 commands.
 */
export function buildHeuristicPlan(
  request: ChatCommandRequest,
  previousPlan?: Plan,
): Plan | undefined {
  const message = request.message.toLowerCase().trim();
  const requestedBlock = parseRequestedBlock(message);
  if (requestedBlock && isMaterialFollowUpMessage(message)) {
    if (isMaterialAdjustableStructurePlan(previousPlan)) {
      return PlanSchema.parse(
        buildStructureMaterialFollowUpFromPreviousPlan(previousPlan, requestedBlock),
      );
    }
    return PlanSchema.parse(buildStructureFollowUpClarification(request));
  }

  if (message.includes("taller") || message.includes("higher")) {
    if (isHeightAdjustableStructurePlan(previousPlan)) {
      return PlanSchema.parse(
        buildStructureFollowUpFromPreviousPlan(request, previousPlan),
      );
    }
    return PlanSchema.parse(buildStructureFollowUpClarification(request));
  }
  return undefined;
}

function buildStructureFollowUpFromPreviousPlan(
  request: ChatCommandRequest,
  previousPlan: Plan,
): Plan {
  const increaseBy = parseHeightDelta(request.message) ?? 2;
  const previousRegion = normalizeRegion(previousPlan.targetRegion);
  const block = extractPrimaryBuildBlock(previousPlan) ?? "minecraft:stone";
  const from = {
    x: previousRegion.min.x,
    y: previousRegion.max.y + 1,
    z: previousRegion.min.z,
  };
  const to = {
    x: previousRegion.max.x,
    y: previousRegion.max.y + increaseBy,
    z: previousRegion.max.z,
  };

  return {
    intent: previousPlan.intent,
    targetWorld: previousPlan.targetWorld,
    targetRegion: {
      world: previousRegion.world,
      min: previousRegion.min,
      max: {
        x: previousRegion.max.x,
        y: previousRegion.max.y + increaseBy,
        z: previousRegion.max.z,
      },
    },
    assumptions: [
      `Extending the previously built structure by ${increaseBy} blocks using ${block}.`,
    ],
    passes: [
      {
        name: "structure_extension",
        goal: "Increase structure height by extending the existing footprint.",
        primitives: [
          {
            type: "fill_cuboid",
            from,
            to,
            block,
          },
        ],
      },
    ],
    reply: `Making it ${increaseBy} blocks taller.`,
    needsMoreInfo: false,
  };
}

function buildStructureMaterialFollowUpFromPreviousPlan(
  previousPlan: Plan,
  block: string,
): Plan {
  const previousRegion = normalizeRegion(previousPlan.targetRegion);
  return {
    intent: previousPlan.intent,
    targetWorld: previousPlan.targetWorld,
    targetRegion: previousRegion,
    assumptions: [
      `Restyling the previously built structure in ${block}.`,
    ],
    passes: previousPlan.passes.map((pass) => ({
      ...pass,
      primitives: pass.primitives.map((primitive) => {
        switch (primitive.type) {
          case "set_block":
          case "fill_cuboid":
          case "hollow_cuboid":
          case "cylinder":
            return {
              ...primitive,
              block,
            };
          case "replace_in_region":
          case "clear_region":
            return primitive;
        }
      }),
    })),
    reply: `Restyling it in ${block}.`,
    needsMoreInfo: false,
  };
}

function buildStructureFollowUpClarification(request: ChatCommandRequest): Plan {
  const point = asBlock(request.player.position);
  return {
    intent: "unknown",
    targetWorld: request.player.world,
    targetRegion: {
      world: request.player.world,
      min: point,
      max: point,
    },
    assumptions: [],
    passes: [],
    reply: "Tell me which structure to make taller.",
    needsMoreInfo: true,
    clarification:
      "I need structure context. Try `make that structure taller by 2` or look at the structure and ask again.",
  };
}

function parseHeightDelta(message: string): number | undefined {
  const lowered = message.toLowerCase();
  if (!lowered.includes("taller") && !lowered.includes("higher")) {
    return undefined;
  }

  const byMatch = lowered.match(/(?:by|add)\s+(\d+)/);
  if (byMatch) {
    const delta = Number.parseInt(byMatch[1], 10);
    return Number.isFinite(delta) ? Math.max(1, Math.min(8, delta)) : undefined;
  }

  const fallbackMatch = lowered.match(/\b(\d+)\b/);
  if (!fallbackMatch) {
    return undefined;
  }

  const fallback = Number.parseInt(fallbackMatch[1], 10);
  return Number.isFinite(fallback) ? Math.max(1, Math.min(8, fallback)) : undefined;
}

function isMaterialFollowUpMessage(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (trimmed.length === 0) {
    return false;
  }
  if (/\b(build|create|construct|remove|delete|destroy)\b/.test(trimmed)) {
    return false;
  }
  if (!/\b(it|that|same|instead|swap|change|use|in)\b/.test(trimmed)) {
    return trimmed.split(/\s+/).length === 1;
  }
  return true;
}

function extractPrimaryBuildBlock(plan: Plan): string | undefined {
  for (const pass of plan.passes) {
    for (const primitive of pass.primitives) {
      switch (primitive.type) {
        case "set_block":
        case "fill_cuboid":
        case "hollow_cuboid":
        case "cylinder":
          return primitive.block;
        case "replace_in_region":
        case "clear_region":
          break;
      }
    }
  }
  return undefined;
}

function isHeightAdjustableStructurePlan(plan?: Plan): plan is Plan {
  if (!plan || plan.needsMoreInfo || plan.passes.length === 0) {
    return false;
  }
  return hasAdditiveStructurePrimitive(plan);
}

function isMaterialAdjustableStructurePlan(plan?: Plan): plan is Plan {
  if (!plan || plan.needsMoreInfo || plan.passes.length === 0) {
    return false;
  }
  return hasAdditiveStructurePrimitive(plan);
}

function hasAdditiveStructurePrimitive(plan: Plan): boolean {
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
