/**
 * Shared valid layer maps for tests and smoke tooling. Production plans use the
 * same shape: `primitives: []` and a `layerMap` per pass.
 */
export const LAYER_MAP_1x1x1_STONE = {
  layers: ["S"],
  palette: { S: "minecraft:stone", _: "minecraft:air" },
};

/** 3×1 footprint, one Y layer — multiple batchSet blocks when compiled. */
export const LAYER_MAP_3x1x1_GLASS = {
  layers: ["GGG"],
  palette: { G: "minecraft:glass", _: "minecraft:air" },
};
