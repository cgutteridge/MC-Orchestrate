import type { ChatCommandRequest } from "../types/plugin.js";
import {
  asBlock,
  normalizeRegion,
  parseRequestedBlock,
  parseRequestedHeight,
  structureFootprintOrigin,
  structureAnchorPoint,
} from "./requestContext.js";
import { PlanSchema, type Plan } from "./schema.js";

/**
 * Returns a deterministic fallback plan for the small set of built-in v1 commands.
 */
export function buildHeuristicPlan(
  request: ChatCommandRequest,
  previousPlan?: Plan,
): Plan | undefined {
  const message = request.message.toLowerCase();
  const recent = request.recentMessages.map((entry) => entry.toLowerCase());
  if (message.includes("taller") || message.includes("higher")) {
    if (isHeightAdjustableStructurePlan(previousPlan)) {
      return PlanSchema.parse(
        buildStructureFollowUpFromPreviousPlan(request, previousPlan),
      );
    }
    if (recent.some((entry) => entry.includes("tower"))) {
      return PlanSchema.parse(buildTowerFollowUpPlan(request));
    }
    return PlanSchema.parse(buildStructureFollowUpClarification(request));
  }
  if (message.includes("house")) {
    return PlanSchema.parse(buildHousePlan(request));
  }
  if (message.includes("tower")) {
    return PlanSchema.parse(buildTowerPlan(request));
  }
  if (
    message.includes("delete this tree") ||
    message.includes("remove this tree")
  ) {
    return PlanSchema.parse(buildRemoveTreePlan(request));
  }
  return undefined;
}

function buildTowerFollowUpPlan(request: ChatCommandRequest): Plan {
  const baseHeight = mostRecentRequestedHeight(request.recentMessages) ?? 5;
  const increaseBy = parseHeightDelta(request.message) ?? 2;
  const height = Math.max(1, Math.min(16, baseHeight + increaseBy));
  const base = structureAnchorPoint(request, 4);
  const block =
    parseRequestedBlock(request.message) ??
    mostRecentRequestedBlock(request.recentMessages) ??
    "minecraft:stone";

  return {
    intent: "build_tower",
    targetWorld: request.player.world,
    targetRegion: {
      world: request.player.world,
      min: base,
      max: { x: base.x, y: base.y + height - 1, z: base.z },
    },
    assumptions: [`Interpreting follow-up as making the previous tower taller by ${increaseBy} blocks.`],
    passes: [
      {
        name: "tower_column",
        goal: "Build the taller tower shaft.",
        primitives: [
          {
            type: "fill_cuboid",
            from: base,
            to: { x: base.x, y: base.y + height - 1, z: base.z },
            block,
          },
        ],
      },
    ],
    reply: `Making it ${increaseBy} blocks taller.`,
    needsMoreInfo: false,
  };
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

  const intent =
    previousPlan.intent === "build_house" ? "build_house" : "build_tower";

  return {
    intent,
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

function buildTowerPlan(request: ChatCommandRequest): Plan {
  const height = parseRequestedHeight(request.message) ?? 5;
  const base = structureAnchorPoint(request, 4);
  const block = parseRequestedBlock(request.message) ?? "minecraft:stone";

  return {
    intent: "build_tower",
    targetWorld: request.player.world,
    targetRegion: {
      world: request.player.world,
      min: base,
      max: { x: base.x, y: base.y + height - 1, z: base.z },
    },
    assumptions: [`Using ${block} for the tower.`],
    passes: [
      {
        name: "tower_column",
        goal: "Build the tower shaft.",
        primitives: [
          {
            type: "fill_cuboid",
            from: base,
            to: { x: base.x, y: base.y + height - 1, z: base.z },
            block,
          },
        ],
      },
    ],
    reply: `Building a ${height}-block tower.`,
    needsMoreInfo: false,
  };
}

function buildHousePlan(request: ChatCommandRequest): Plan {
  const width = 7;
  const depth = 7;
  const base = structureFootprintOrigin(request, width, depth, 2);
  const wallHeight = 4;
  const wallBlock = parseRequestedBlock(request.message) ?? "minecraft:oak_planks";
  const roofBlock = "minecraft:cobblestone";
  const floorBlock = "minecraft:oak_planks";

  const min = { x: base.x, y: base.y, z: base.z };
  const max = { x: base.x + width - 1, y: base.y + wallHeight + 2, z: base.z + depth - 1 };

  return {
    intent: "build_house",
    targetWorld: request.player.world,
    targetRegion: {
      world: request.player.world,
      min,
      max,
    },
    assumptions: ["Using a compact 7x7 starter house layout."],
    passes: [
      {
        name: "site_prep",
        goal: "Clear the interior build volume.",
        primitives: [
          {
            type: "clear_region",
            from: { x: min.x, y: min.y, z: min.z },
            to: { x: max.x, y: max.y, z: max.z },
          },
        ],
      },
      {
        name: "foundation",
        goal: "Lay the floor.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: min.x, y: min.y, z: min.z },
            to: { x: min.x + width - 1, y: min.y, z: min.z + depth - 1 },
            block: floorBlock,
          },
        ],
      },
      {
        name: "walls",
        goal: "Build the wall shell.",
        primitives: [
          {
            type: "hollow_cuboid",
            from: { x: min.x, y: min.y + 1, z: min.z },
            to: { x: min.x + width - 1, y: min.y + wallHeight, z: min.z + depth - 1 },
            block: wallBlock,
          },
        ],
      },
      {
        name: "openings",
        goal: "Carve the door and windows.",
        primitives: [
          {
            type: "clear_region",
            from: { x: min.x + 3, y: min.y + 1, z: min.z },
            to: { x: min.x + 3, y: min.y + 2, z: min.z },
          },
          {
            type: "clear_region",
            from: { x: min.x, y: min.y + 2, z: min.z + 2 },
            to: { x: min.x, y: min.y + 2, z: min.z + 3 },
          },
          {
            type: "clear_region",
            from: { x: min.x + width - 1, y: min.y + 2, z: min.z + 2 },
            to: { x: min.x + width - 1, y: min.y + 2, z: min.z + 3 },
          },
        ],
      },
      {
        name: "roof",
        goal: "Add a simple flat roof cap.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: min.x, y: min.y + wallHeight + 1, z: min.z },
            to: {
              x: min.x + width - 1,
              y: min.y + wallHeight + 1,
              z: min.z + depth - 1,
            },
            block: roofBlock,
          },
        ],
      },
    ],
    reply: "Building a small house.",
    needsMoreInfo: false,
  };
}

function buildRemoveTreePlan(request: ChatCommandRequest): Plan {
  const target = request.localContext.targetBlock;
  if (!target) {
    const here = asBlock(request.player.position);
    return {
      intent: "remove_tree",
      targetWorld: request.player.world,
      targetRegion: {
        world: request.player.world,
        min: here,
        max: here,
      },
      assumptions: [],
      passes: [],
      reply: "I need you to look directly at the tree first.",
      needsMoreInfo: true,
      clarification: "Look at the tree and ask again.",
    };
  }

  const min = { x: target.x - 2, y: target.y - 1, z: target.z - 2 };
  const max = { x: target.x + 2, y: target.y + 8, z: target.z + 2 };

  return {
    intent: "remove_tree",
    targetWorld: request.player.world,
    targetRegion: {
      world: request.player.world,
      min,
      max,
    },
    assumptions: ["Removing local logs and leaves in a small tree-sized box."],
    passes: [
      {
        name: "remove_logs",
        goal: "Remove tree trunks in the target region.",
        primitives: [
          {
            type: "replace_in_region",
            from: min,
            to: max,
            fromBlock: "minecraft:oak_log",
            toBlock: "minecraft:air",
          },
          {
            type: "replace_in_region",
            from: min,
            to: max,
            fromBlock: "minecraft:birch_log",
            toBlock: "minecraft:air",
          },
          {
            type: "replace_in_region",
            from: min,
            to: max,
            fromBlock: "minecraft:spruce_log",
            toBlock: "minecraft:air",
          },
        ],
      },
      {
        name: "remove_leaves",
        goal: "Remove leaf blocks in the target region.",
        primitives: [
          {
            type: "replace_in_region",
            from: min,
            to: max,
            fromBlock: "minecraft:oak_leaves",
            toBlock: "minecraft:air",
          },
          {
            type: "replace_in_region",
            from: min,
            to: max,
            fromBlock: "minecraft:birch_leaves",
            toBlock: "minecraft:air",
          },
          {
            type: "replace_in_region",
            from: min,
            to: max,
            fromBlock: "minecraft:spruce_leaves",
            toBlock: "minecraft:air",
          },
        ],
      },
    ],
    reply: "Removing that tree.",
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
      "I need structure context. Try `make the wool tower taller by 2` or look at the structure and ask again.",
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

function mostRecentRequestedHeight(messages: string[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parsed = parseRequestedHeight(messages[index]);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function mostRecentRequestedBlock(messages: string[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parsed = parseRequestedBlock(messages[index]);
    if (parsed) {
      return parsed;
    }
  }
  return undefined;
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
  if (plan.intent === "remove_tree" || plan.intent === "unknown") {
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
