const MATERIAL_ALIASES: Record<string, string> = {
  wool: "minecraft:white_wool",
  "minecraft:wool": "minecraft:white_wool",
  white_wool: "minecraft:white_wool",
  "white wool": "minecraft:white_wool",
  "minecraft:white_wool": "minecraft:white_wool",
  wood: "minecraft:oak_planks",
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
  spruce_planks: "minecraft:spruce_planks",
  "minecraft:spruce_planks": "minecraft:spruce_planks",
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
  "spruce planks",
  "oak log",
  "oak fence",
  "glass",
  "white wool",
  "grass block",
  "stone bricks",
].join(", ");

const SUPPORTED_BLOCK_IDS = new Set(Object.values(MATERIAL_ALIASES));

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

export function parseRequestedBlock(message: string): string | undefined {
  const lowered = message.toLowerCase();
  const explicitIds = lowered.match(/minecraft:[a-z0-9_]+/g);
  if (explicitIds) {
    for (const explicit of explicitIds) {
      const normalized = normalizeMaterialKey(explicit);
      return MATERIAL_ALIASES[normalized] ?? explicit;
    }
  }

  for (const entry of TEXT_ALIAS_ENTRIES) {
    if (entry.match.test(lowered)) {
      return entry.block;
    }
  }

  return undefined;
}

export function normalizeBlockId(block: string): string {
  const normalized = normalizeMaterialKey(block);
  return MATERIAL_ALIASES[normalized] ?? normalized;
}

export {
  MATERIAL_ALIASES,
  SUPPORTED_BLOCK_IDS,
  SUPPORTED_MATERIAL_HINTS,
};

function normalizeMaterialKey(value: string): string {
  return value.toLowerCase().trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
