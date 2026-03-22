import type { ChatCommandRequest } from "../types/plugin.js";
import { PlanSchema, type Plan, type Primitive } from "./schema.js";
import {
  GRAVITY_BLOCKS,
  MATERIAL_ALIASES,
  NON_STRUCTURAL_BLOCKS,
  SUPPORTED_MATERIAL_HINTS,
  isValidMinecraftBlockId,
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

/** Default block used when {@link ResolvePlanMaterialsOptions.fallbackInvalidBlocksToStone} substitutes invalid ids. */
export const MATERIAL_FALLBACK_BLOCK = "minecraft:stone" as const;

/** Reply text on the plan when material resolution fails and no fallback is applied. */
export const MATERIAL_RESOLUTION_FAILURE_REPLY =
  "I need clearer material choices before I can build that.";

export type ResolvePlanMaterialsOptions = {
  /**
   * When true, any block id the model provided that would normally trigger a
   * material clarification is replaced with {@link MATERIAL_FALLBACK_BLOCK}
   * instead of failing. Used after the player already received one material
   * pushback, or for verify-pass polish plans.
   */
  fallbackInvalidBlocksToStone?: boolean;
};

/**
 * Returns true when `plan` is the material-clarification outcome from
 * {@link resolvePlanMaterials} (no fallback), so the orchestrator can offer
 * stone substitution on the next player turn.
 *
 * @param plan A plan possibly produced by material resolution.
 */
export function isMaterialResolutionFailure(plan: Plan): boolean {
  return (
    plan.needsMoreInfo === true &&
    plan.passes.length === 0 &&
    plan.reply === MATERIAL_RESOLUTION_FAILURE_REPLY
  );
}

/**
 * Resolves all symbolic material slots and generic aliases in a plan's
 * primitives to concrete `minecraft:` block ids, using the player's nearby
 * block histogram and explicit material hints as ranking signals.
 *
 * When any block cannot be resolved safely the entire plan is replaced with a
 * `needsMoreInfo` clarification so the player is never silently given a bad
 * build — unless {@link ResolvePlanMaterialsOptions.fallbackInvalidBlocksToStone}
 * is set, in which case invalid codes become {@link MATERIAL_FALLBACK_BLOCK}.
 */
export function resolvePlanMaterials(
  plan: Plan,
  request: ChatCommandRequest,
  options?: ResolvePlanMaterialsOptions,
): Plan {
  const fallback = options?.fallbackInvalidBlocksToStone === true;
  const unresolved = new Set<string>();
  const context = buildMaterialResolutionContext(request);

  const passes = plan.passes.map((pass) => {
    if (pass.layerMap) {
      return {
        ...pass,
        primitives: [],
        layerMap: {
          ...pass.layerMap,
          palette: resolveLayerPalette(
            pass.layerMap.palette,
            unresolved,
            context,
            fallback,
          ),
        },
      };
    }
    return {
      ...pass,
      primitives: pass.primitives.map((primitive) =>
        resolvePrimitiveMaterials(primitive, unresolved, context, fallback),
      ),
    };
  });

  if (unresolved.size > 0) {
    const materials = Array.from(unresolved).sort().join(", ");
    return PlanSchema.parse({
      ...plan,
      intent: "unknown",
      passes: [],
      needsMoreInfo: true,
      reply: MATERIAL_RESOLUTION_FAILURE_REPLY,
      clarification:
        `I couldn't safely map these materials: ${materials}. ` +
        `Use a valid block id like \`minecraft:stone\` or \`minecraft:deepslate\` (namespace:path). ` +
        `Examples of common blocks: ${SUPPORTED_MATERIAL_HINTS}.`,
      targetWorld: request.player.world,
    });
  }

  return PlanSchema.parse({
    ...plan,
    passes,
  });
}

function resolveLayerPalette(
  palette: Record<string, string>,
  unresolved: Set<string>,
  context: MaterialResolutionContext,
  fallback: boolean,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ch, block] of Object.entries(palette)) {
    if (ch === " ") {
      // Legacy palette keys used space for air; space in `layers` is now no-op — omit.
      continue;
    }
    out[ch] = resolveBlockId(block, unresolved, context, false, undefined, fallback);
  }
  return out;
}

function resolvePrimitiveMaterials(
  primitive: Primitive,
  unresolved: Set<string>,
  context: MaterialResolutionContext,
  fallback: boolean,
): Primitive {
  switch (primitive.type) {
    case "set_block":
      return {
        ...primitive,
        block: resolveBlockId(primitive.block, unresolved, context, true, undefined, fallback),
      };
    case "fill_cuboid":
    case "hollow_cuboid":
      return {
        ...primitive,
        block: resolveBlockId(
          primitive.block,
          unresolved,
          context,
          true,
          primitive.type,
          fallback,
        ),
      };
    case "cylinder":
      return {
        ...primitive,
        block: resolveBlockId(
          primitive.block,
          unresolved,
          context,
          true,
          primitive.type,
          fallback,
        ),
      };
    case "replace_in_region":
      // fromBlock and toBlock may be operational values (minecraft:air to clear,
      // minecraft:water to fill) — structural constraint does not apply.
      return {
        ...primitive,
        fromBlock: resolveBlockId(
          primitive.fromBlock,
          unresolved,
          context,
          false,
          undefined,
          fallback,
        ),
        toBlock: resolveBlockId(
          primitive.toBlock,
          unresolved,
          context,
          false,
          undefined,
          fallback,
        ),
      };
    case "clear_region":
      return primitive;
  }
}

function resolveBlockId(
  block: string,
  unresolved: Set<string>,
  context: MaterialResolutionContext,
  structural: boolean,
  primitiveType: Primitive["type"] | undefined,
  fallback: boolean,
): string {
  const normalized = block.toLowerCase().trim();
  const slot = parseMaterialSlot(normalized);
  if (slot) {
    const resolved = selectSlotMaterial(slot, context);
    if (resolved) {
      return resolved;
    }
    if (fallback) {
      return MATERIAL_FALLBACK_BLOCK;
    }
    unresolved.add(block);
    return block;
  }

  const slotSyntaxKey = getSymbolicSlotKeyIfInvalid(normalized);
  if (slotSyntaxKey !== undefined) {
    if (fallback) {
      return MATERIAL_FALLBACK_BLOCK;
    }
    unresolved.add(block);
    return block;
  }

  const mapped =
    MATERIAL_ALIASES[normalized] ??
    (isValidMinecraftBlockId(normalized) ? normalized : undefined);
  if (!mapped) {
    if (fallback) {
      return MATERIAL_FALLBACK_BLOCK;
    }
    unresolved.add(block);
    return block;
  }

  if (structural && isUnsafeForStructure(mapped, primitiveType)) {
    if (fallback) {
      return MATERIAL_FALLBACK_BLOCK;
    }
    unresolved.add(block);
    return block;
  }

  return mapped;
}

/**
 * Returns `true` when a block is unsuitable for use in structural build
 * primitives — either because it is non-solid/fluid or because it is
 * gravity-affected and will fall without support.
 *
 * Fluids (`minecraft:water`, `minecraft:lava`) are allowed for volumetric
 * {@link Primitive} types `fill_cuboid` and `cylinder` (moats, pools) but not
 * for shells (`hollow_cuboid`, `set_block`).
 */
function isUnsafeForStructure(
  block: string,
  primitiveType?: Primitive["type"],
): boolean {
  if (
    (block === "minecraft:water" || block === "minecraft:lava") &&
    (primitiveType === "fill_cuboid" || primitiveType === "cylinder")
  ) {
    return false;
  }
  return NON_STRUCTURAL_BLOCKS.has(block) || GRAVITY_BLOCKS.has(block);
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
    if (!isValidMinecraftBlockId(mapped)) {
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

/**
 * When the string looks like a symbolic slot (`material:…`, `{{…}}`, etc.) but
 * the slot name is not in {@link MATERIAL_SLOT_ALIASES}, returns the raw key;
 * otherwise `undefined`. Reserved so `material:chimney` does not become a
 * valid block id via `minecraft:`-style validation.
 */
function getSymbolicSlotKeyIfInvalid(normalized: string): string | undefined {
  if (normalized.startsWith("material:") || normalized.startsWith("material.")) {
    const key = normalized.slice(9);
    return MATERIAL_SLOT_ALIASES[key] === undefined ? key : undefined;
  }
  if (normalized.startsWith("slot:") || normalized.startsWith("slot.")) {
    const key = normalized.slice(5);
    return MATERIAL_SLOT_ALIASES[key] === undefined ? key : undefined;
  }
  if (normalized.startsWith("$")) {
    const key = normalized.slice(1);
    return MATERIAL_SLOT_ALIASES[key] === undefined ? key : undefined;
  }
  if (normalized.startsWith("{{") && normalized.endsWith("}}")) {
    const key = normalized.slice(2, -2).trim();
    return MATERIAL_SLOT_ALIASES[key] === undefined ? key : undefined;
  }
  if (normalized.endsWith("_material")) {
    const key = normalized.slice(0, -9);
    return MATERIAL_SLOT_ALIASES[key] === undefined ? key : undefined;
  }
  return undefined;
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
    return MATERIAL_SLOT_ALIASES[value.slice(2, -2).trim()];
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
    block.includes("_log")
  );
}

function isStoneBlock(block: string): boolean {
  return (
    block.includes("stone") ||
    block.includes("cobblestone") ||
    block.includes("brick")
  );
}
