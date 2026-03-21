import type { ChatCommandRequest } from "../types/plugin.js";
import {
  anchorPoint,
  asBlock,
  parseRequestedBlock,
  parseRequestedHeight,
} from "./requestContext.js";
import { PlanSchema, type Plan } from "./schema.js";

export function buildHeuristicPlan(
  request: ChatCommandRequest,
): Plan | undefined {
  const message = request.message.toLowerCase();
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

function buildTowerPlan(request: ChatCommandRequest): Plan {
  const height = parseRequestedHeight(request.message) ?? 5;
  const base = anchorPoint(request, 2);
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
  const base = anchorPoint(request, 3);
  const width = 7;
  const depth = 7;
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
