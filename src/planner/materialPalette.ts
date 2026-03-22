import { escapeRegex } from "../utils/regex.js";

const MATERIAL_ALIASES: Record<string, string> = {
  wool: "minecraft:white_wool",
  "minecraft:wool": "minecraft:white_wool",
  white_wool: "minecraft:white_wool",
  "white wool": "minecraft:white_wool",
  "minecraft:white_wool": "minecraft:white_wool",
  wood: "minecraft:oak_planks",
  oak: "minecraft:oak_planks",
  "minecraft:wood": "minecraft:oak_planks",
  lumber: "minecraft:oak_planks",
  planks: "minecraft:oak_planks",
  "oak planks": "minecraft:oak_planks",
  oak_planks: "minecraft:oak_planks",
  "minecraft:oak_planks": "minecraft:oak_planks",
  stone: "minecraft:stone",
  "minecraft:stone": "minecraft:stone",
  cobblestone: "minecraft:cobblestone",
  "minecraft:cobblestone": "minecraft:cobblestone",
  glass: "minecraft:glass",
  "minecraft:glass": "minecraft:glass",
  water: "minecraft:water",
  "minecraft:water": "minecraft:water",
  lava: "minecraft:lava",
  "minecraft:lava": "minecraft:lava",
  air: "minecraft:air",
  "minecraft:air": "minecraft:air",
  dirt: "minecraft:dirt",
  "minecraft:dirt": "minecraft:dirt",
  grass: "minecraft:grass_block",
  "grass block": "minecraft:grass_block",
  grass_block: "minecraft:grass_block",
  "minecraft:grass_block": "minecraft:grass_block",
  path: "minecraft:dirt_path",
  dirt_path: "minecraft:dirt_path",
  "minecraft:dirt_path": "minecraft:dirt_path",
  "stone bricks": "minecraft:stone_bricks",
  stone_bricks: "minecraft:stone_bricks",
  "minecraft:stone_bricks": "minecraft:stone_bricks",
  "spruce planks": "minecraft:spruce_planks",
  spruce: "minecraft:spruce_planks",
  spruce_planks: "minecraft:spruce_planks",
  "minecraft:spruce_planks": "minecraft:spruce_planks",
  birch: "minecraft:birch_planks",
  "birch planks": "minecraft:birch_planks",
  birch_planks: "minecraft:birch_planks",
  "minecraft:birch_planks": "minecraft:birch_planks",
  fence: "minecraft:oak_fence",
  "oak fence": "minecraft:oak_fence",
  oak_fence: "minecraft:oak_fence",
  "minecraft:oak_fence": "minecraft:oak_fence",
  "spruce fence": "minecraft:spruce_fence",
  spruce_fence: "minecraft:spruce_fence",
  "minecraft:spruce_fence": "minecraft:spruce_fence",
  slab: "minecraft:oak_slab",
  "oak slab": "minecraft:oak_slab",
  oak_slab: "minecraft:oak_slab",
  "minecraft:oak_slab": "minecraft:oak_slab",
  stairs: "minecraft:oak_stairs",
  "oak stairs": "minecraft:oak_stairs",
  oak_stairs: "minecraft:oak_stairs",
  "minecraft:oak_stairs": "minecraft:oak_stairs",
  "spruce stairs": "minecraft:spruce_stairs",
  spruce_stairs: "minecraft:spruce_stairs",
  "minecraft:spruce_stairs": "minecraft:spruce_stairs",
  "stone brick stairs": "minecraft:stone_brick_stairs",
  stone_brick_stairs: "minecraft:stone_brick_stairs",
  "minecraft:stone_brick_stairs": "minecraft:stone_brick_stairs",
  "cobblestone stairs": "minecraft:cobblestone_stairs",
  cobblestone_stairs: "minecraft:cobblestone_stairs",
  "minecraft:cobblestone_stairs": "minecraft:cobblestone_stairs",
  "oak log": "minecraft:oak_log",
  oak_log: "minecraft:oak_log",
  "minecraft:oak_log": "minecraft:oak_log",
  "birch log": "minecraft:birch_log",
  birch_log: "minecraft:birch_log",
  "minecraft:birch_log": "minecraft:birch_log",
  "spruce log": "minecraft:spruce_log",
  spruce_log: "minecraft:spruce_log",
  "minecraft:spruce_log": "minecraft:spruce_log",
  "oak leaves": "minecraft:oak_leaves",
  oak_leaves: "minecraft:oak_leaves",
  "minecraft:oak_leaves": "minecraft:oak_leaves",
  "birch leaves": "minecraft:birch_leaves",
  birch_leaves: "minecraft:birch_leaves",
  "minecraft:birch_leaves": "minecraft:birch_leaves",
  "spruce leaves": "minecraft:spruce_leaves",
  spruce_leaves: "minecraft:spruce_leaves",
  "minecraft:spruce_leaves": "minecraft:spruce_leaves",
};

const SUPPORTED_MATERIAL_HINTS = [
  "stone",
  "cobblestone",
  "oak planks",
  "spruce stairs",
  "spruce planks",
  "oak log",
  "oak fence",
  "glass",
  "white wool",
  "grass block",
  "stone bricks",
].join(", ");

/**
 * Returns true when `id` matches a Java resource-location shape suitable for
 * block ids (`namespace:path`). Does not consult the live server registry —
 * invalid but well-formed ids are accepted and may fail at execution time.
 * Block states (`foo[axis=x]`) are rejected.
 */
export function isValidMinecraftBlockId(id: string): boolean {
  const s = id.toLowerCase().trim();
  if (s.length < 3 || s.length > 256) {
    return false;
  }
  if (s.includes("[") || s.includes("]")) {
    return false;
  }
  return /^[a-z0-9._-]+:[a-z0-9/._-]+$/.test(s);
}

/**
 * Blocks that are non-solid or fluid and must not be used as structural
 * building materials (walls, floors, roofs, trim). `minecraft:water` /
 * `minecraft:lava` may still be used in volumetric `fill_cuboid` / `cylinder`
 * when the material resolver allows fluid fills (moats, pools). They remain valid for
 * `replace_in_region` and `clear_region` operational uses.
 */
const NON_STRUCTURAL_BLOCKS = new Set([
  "minecraft:air",
  "minecraft:water",
  "minecraft:lava",
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:dirt_path",
  "minecraft:oak_leaves",
  "minecraft:birch_leaves",
  "minecraft:spruce_leaves",
]);

/**
 * Gravity-affected blocks that fall when unsupported. These must not be used
 * in structural wall, roof, or trim slots.
 */
const GRAVITY_BLOCKS = new Set([
  "minecraft:sand",
  "minecraft:red_sand",
  "minecraft:gravel",
  "minecraft:white_concrete_powder",
  "minecraft:orange_concrete_powder",
  "minecraft:magenta_concrete_powder",
  "minecraft:light_blue_concrete_powder",
  "minecraft:yellow_concrete_powder",
  "minecraft:lime_concrete_powder",
  "minecraft:pink_concrete_powder",
  "minecraft:gray_concrete_powder",
  "minecraft:light_gray_concrete_powder",
  "minecraft:cyan_concrete_powder",
  "minecraft:purple_concrete_powder",
  "minecraft:blue_concrete_powder",
  "minecraft:brown_concrete_powder",
  "minecraft:green_concrete_powder",
  "minecraft:red_concrete_powder",
  "minecraft:black_concrete_powder",
]);

const TEXT_ALIAS_ENTRIES = Object.entries(MATERIAL_ALIASES)
  .filter(([alias]) => !alias.startsWith("minecraft:"))
  .map(([alias, block]) => {
    const normalized = alias.toLowerCase().replace(/_/g, " ").trim();
    return {
      block,
      match: new RegExp(`\\b${escapeRegex(normalized)}\\b`, "i"),
      length: normalized.length,
    };
  })
  .sort((a, b) => b.length - a.length);

/**
 * Extracts a single concrete Minecraft block id from freeform player text.
 *
 * Prefers explicit `minecraft:` ids, then falls back to the longest matching
 * text alias. Returns `undefined` when no recognised material is found.
 *
 * @remarks Only the first matched explicit id is returned; messages that
 * contain multiple `minecraft:` ids are not currently supported.
 */
export function parseRequestedBlock(message: string): string | undefined {
  const lowered = message.toLowerCase();
  const explicitIds = lowered.match(/minecraft:[a-z0-9_]+/g);
  if (explicitIds) {
    // Returns only the first matched explicit id; messages with multiple ids
    // are not currently supported.
    for (const explicit of explicitIds) {
      const normalized = normalizeMaterialKey(explicit);
      const resolved =
        MATERIAL_ALIASES[normalized] ??
        (isValidMinecraftBlockId(normalized) ? normalized : undefined);
      if (resolved) {
        return resolved;
      }
    }
  }

  for (const entry of TEXT_ALIAS_ENTRIES) {
    if (entry.match.test(lowered)) {
      return entry.block;
    }
  }

  return undefined;
}

/**
 * Normalises a raw block id or alias to its canonical `minecraft:` form.
 * Returns the input unchanged when no alias mapping exists.
 */
export function normalizeBlockId(block: string): string {
  const normalized = normalizeMaterialKey(block);
  if (MATERIAL_ALIASES[normalized]) {
    return MATERIAL_ALIASES[normalized];
  }
  if (isValidMinecraftBlockId(normalized)) {
    return normalized;
  }
  return normalized;
}

export {
  GRAVITY_BLOCKS,
  MATERIAL_ALIASES,
  NON_STRUCTURAL_BLOCKS,
  SUPPORTED_MATERIAL_HINTS,
};

function normalizeMaterialKey(value: string): string {
  return value.toLowerCase().trim();
}
