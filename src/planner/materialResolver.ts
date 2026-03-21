import type { ChatCommandRequest } from "../types/plugin.js";
import { PlanSchema, type Plan, type Primitive } from "./schema.js";
import {
  MATERIAL_ALIASES,
  SUPPORTED_BLOCK_IDS,
  SUPPORTED_MATERIAL_HINTS,
  parseRequestedBlock,
} from "./materialPalette.js";

const MATERIAL_SLOT_CANDIDATES = {
  wall: [
    "minecraft:stone_bricks",
    "minecraft:cobblestone",
    "minecraft:stone",
    "minecraft:oak_planks",
    "minecraft:spruce_planks",
  ],
  roof: [
    "minecraft:oak_stairs",
    "minecraft:spruce_stairs",
    "minecraft:stone_brick_stairs",
    "minecraft:cobblestone_stairs",
  ],
  floor: [
    "minecraft:oak_planks",
    "minecraft:spruce_planks",
    "minecraft:stone_bricks",
    "minecraft:stone",
  ],
  trim: [
    "minecraft:oak_log",
    "minecraft:spruce_log",
    "minecraft:stone_bricks",
  ],
  detail: [
    "minecraft:oak_fence",
    "minecraft:spruce_fence",
    "minecraft:glass",
  ],
  wood: [
    "minecraft:oak_planks",
    "minecraft:spruce_planks",
    "minecraft:oak_log",
    "minecraft:spruce_log",
  ],
  stone: [
    "minecraft:stone_bricks",
    "minecraft:cobblestone",
    "minecraft:stone",
  ],
  glass: ["minecraft:glass"],
  wool: ["minecraft:white_wool"],
} as const;

type MaterialSlot = keyof typeof MATERIAL_SLOT_CANDIDATES;

const MATERIAL_SLOT_ALIASES: Record<string, MaterialSlot> = {
  wall: "wall",
  walls: "wall",
  facade: "wall",
  shell: "wall",
  roof: "roof",
  roofing: "roof",
  floor: "floor",
  flooring: "floor",
  trim: "trim",
  detail: "detail",
  details: "detail",
  wood: "wood",
  timber: "wood",
  stone: "stone",
  masonry: "stone",
  glass: "glass",
  window: "glass",
  windows: "glass",
  wool: "wool",
  textile: "wool",
};

type MaterialResolutionContext = {
  explicitRequestedBlock?: string;
  requestTextLower: string;
  nearbyCounts: Map<string, number>;
  prefersSpruce: boolean;
  prefersWood: boolean;
  prefersStone: boolean;
};

export function resolvePlanMaterials(
  plan: Plan,
  request: ChatCommandRequest,
): Plan {
  const unresolved = new Set<string>();
  const context = buildMaterialResolutionContext(request);

  const passes = plan.passes.map((pass) => ({
    ...pass,
    primitives: pass.primitives.map((primitive) =>
      resolvePrimitiveMaterials(primitive, unresolved, context),
    ),
  }));

  if (unresolved.size > 0) {
    const materials = Array.from(unresolved).sort().join(", ");
    return PlanSchema.parse({
      ...plan,
      intent: "unknown",
      passes: [],
      needsMoreInfo: true,
      reply: "I need clearer material choices before I can build that.",
      clarification:
        `I couldn't safely map these materials: ${materials}. ` +
        `Try a specific block such as ${SUPPORTED_MATERIAL_HINTS}.`,
      targetWorld: request.player.world,
    });
  }

  return PlanSchema.parse({
    ...plan,
    passes,
  });
}

function resolvePrimitiveMaterials(
  primitive: Primitive,
  unresolved: Set<string>,
  context: MaterialResolutionContext,
): Primitive {
  switch (primitive.type) {
    case "set_block":
      return {
        ...primitive,
        block: resolveBlockId(primitive.block, unresolved, context),
      };
    case "fill_cuboid":
    case "hollow_cuboid":
      return {
        ...primitive,
        block: resolveBlockId(primitive.block, unresolved, context),
      };
    case "replace_in_region":
      return {
        ...primitive,
        fromBlock: resolveBlockId(primitive.fromBlock, unresolved, context),
        toBlock: resolveBlockId(primitive.toBlock, unresolved, context),
      };
    case "cylinder":
      return {
        ...primitive,
        block: resolveBlockId(primitive.block, unresolved, context),
      };
    case "clear_region":
      return primitive;
  }
}

function resolveBlockId(
  block: string,
  unresolved: Set<string>,
  context: MaterialResolutionContext,
): string {
  const normalized = block.toLowerCase().trim();
  const slot = parseMaterialSlot(normalized);
  if (slot) {
    const resolved = selectSlotMaterial(slot, context);
    if (resolved) {
      return resolved;
    }
    unresolved.add(block);
    return block;
  }

  const mapped = MATERIAL_ALIASES[normalized];
  if (mapped) {
    return mapped;
  }

  if (SUPPORTED_BLOCK_IDS.has(normalized)) {
    return normalized;
  }

  unresolved.add(block);
  return block;
}

function buildMaterialResolutionContext(
  request: ChatCommandRequest,
): MaterialResolutionContext {
  const requestTextLower = [request.message, ...request.recentMessages]
    .join(" ")
    .toLowerCase();
  const nearbyCounts = new Map<string, number>();
  for (const block of request.localContext.nearbyBlocks) {
    const normalized = block.type.toLowerCase().trim();
    const mapped = MATERIAL_ALIASES[normalized] ?? normalized;
    if (!SUPPORTED_BLOCK_IDS.has(mapped)) {
      continue;
    }
    nearbyCounts.set(mapped, (nearbyCounts.get(mapped) ?? 0) + 1);
  }

  const explicitRequestedBlock = parseRequestedBlock(request.message);
  const woodWeight = nearbyWeight(nearbyCounts, isWoodBlock);
  const stoneWeight = nearbyWeight(nearbyCounts, isStoneBlock);

  return {
    explicitRequestedBlock,
    requestTextLower,
    nearbyCounts,
    prefersSpruce:
      /\bspruce\b/.test(requestTextLower) ||
      (nearbyCounts.get("minecraft:spruce_planks") ?? 0) +
        (nearbyCounts.get("minecraft:spruce_log") ?? 0) >
        (nearbyCounts.get("minecraft:oak_planks") ?? 0) +
          (nearbyCounts.get("minecraft:oak_log") ?? 0),
    prefersWood: /\b(wood|timber|oak|spruce|plank|log)\b/.test(requestTextLower) || woodWeight > stoneWeight,
    prefersStone:
      /\b(stone|cobble|brick|masonry)\b/.test(requestTextLower) || stoneWeight > woodWeight,
  };
}

function parseMaterialSlot(value: string): MaterialSlot | undefined {
  if (value.endsWith("_material")) {
    return MATERIAL_SLOT_ALIASES[value.slice(0, -9)];
  }

  if (value.startsWith("material:") || value.startsWith("material.")) {
    return MATERIAL_SLOT_ALIASES[value.slice(9)];
  }
  if (value.startsWith("slot:") || value.startsWith("slot.")) {
    return MATERIAL_SLOT_ALIASES[value.slice(5)];
  }
  if (value.startsWith("$")) {
    return MATERIAL_SLOT_ALIASES[value.slice(1)];
  }
  if (value.startsWith("{{") && value.endsWith("}}")) {
    return MATERIAL_SLOT_ALIASES[value.slice(2, -2)];
  }
  return undefined;
}

function selectSlotMaterial(
  slot: MaterialSlot,
  context: MaterialResolutionContext,
): string | undefined {
  const candidates = MATERIAL_SLOT_CANDIDATES[slot];
  let best: { block: string; score: number } | undefined;

  for (const [index, block] of candidates.entries()) {
    let score = (context.nearbyCounts.get(block) ?? 0) * 10 - index;
    score += nearbyFamilyWeight(block, context.nearbyCounts) * 6;
    if (context.explicitRequestedBlock === block) {
      score += 100;
    }
    if (context.prefersSpruce && block.includes("spruce")) {
      score += 5;
    }
    if (context.prefersWood && isWoodBlock(block)) {
      score += 3;
    }
    if (context.prefersStone && isStoneBlock(block)) {
      score += 3;
    }
    if (slot === "glass" && block.includes("glass")) {
      score += 5;
    }
    if (slot === "wool" && block.includes("wool")) {
      score += 5;
    }
    if (!best || score > best.score) {
      best = { block, score };
    }
  }

  return best?.block;
}

function nearbyFamilyWeight(
  block: string,
  nearbyCounts: Map<string, number>,
): number {
  const familyKeys = [block];
  if (block === "minecraft:cobblestone_stairs") {
    familyKeys.push("minecraft:cobblestone");
  } else if (block === "minecraft:stone_brick_stairs") {
    familyKeys.push("minecraft:stone_bricks");
  } else if (block === "minecraft:oak_stairs" || block === "minecraft:oak_fence") {
    familyKeys.push("minecraft:oak_planks", "minecraft:oak_log");
  } else if (
    block === "minecraft:spruce_stairs" ||
    block === "minecraft:spruce_fence"
  ) {
    familyKeys.push("minecraft:spruce_planks", "minecraft:spruce_log");
  }

  let total = 0;
  for (const key of familyKeys) {
    total += nearbyCounts.get(key) ?? 0;
  }
  return total;
}

function nearbyWeight(
  nearbyCounts: Map<string, number>,
  predicate: (block: string) => boolean,
): number {
  let weight = 0;
  for (const [block, count] of nearbyCounts.entries()) {
    if (predicate(block)) {
      weight += count;
    }
  }
  return weight;
}

function isWoodBlock(block: string): boolean {
  return (
    block.includes("oak_") ||
    block.includes("spruce_") ||
    block.includes("_planks") ||
    block.includes("_log") ||
    block.includes("_fence") ||
    block.includes("_stairs")
  );
}

function isStoneBlock(block: string): boolean {
  return (
    block.includes("stone") ||
    block.includes("cobblestone") ||
    block.includes("brick")
  );
}
