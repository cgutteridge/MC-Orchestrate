import type { BridgeBatchBlock, BridgeCommand } from "../bridge/types.js";

/**
 * Layer map payload: top-to-bottom layers + character → block id palette.
 *
 * **Grid characters**
 * - **` ` (space)** — no-op: do not place or change this block (skip in compile).
 * - **`_`** — explicit air (`minecraft:air` by default; may appear in `palette`).
 *
 * When the server encodes world data for display, use `_` for air (not space).
 */
export type LayerMapData = {
  layers: string[];
  palette: Record<string, string>;
};

/** Sentinel returned by {@link ParsedLayerGrid.getBlock} for space cells (compile skips). */
export const LAYER_MAP_NOOP_BLOCK = "__layer_map_noop__" as const;

/** Default palette key for explicit air placement. */
export const LAYER_MAP_AIR_CHAR = "_" as const;

/** Max horizontal span (X/Z) per layer-map grid axis — matches {@link MAX_REGION_WIDTH}. */
export const LAYER_MAP_MAX_HORIZONTAL = 32;
/** Max vertical layer count — matches {@link MAX_REGION_HEIGHT}. */
export const LAYER_MAP_MAX_VERTICAL = 48;

const BATCH_SET_CHUNK = 512;

export type ParsedLayerGrid = {
  width: number;
  depth: number;
  height: number;
  /** Bottom Y slice index 0; top = height - 1. */
  getBlock: (lx: number, ly: number, lz: number) => string;
};

/**
 * Validates shape and palette coverage for a layer map. Layers are ordered
 * **top → bottom**: `layers[0]` is the top slice (highest Y), `layers[last]` is
 * the bottom slice (lowest Y). Each layer is newline-separated **rows**; each
 * row is **columns** left-to-right (increasing X). Row index increases with Z.
 *
 * @returns `undefined` when valid, otherwise a human-readable error message.
 */
export function validateLayerMapShape(layerMap: LayerMapData): string | undefined {
  const parsed = parseLayerMapGrid(layerMap);
  return "error" in parsed ? parsed.error : undefined;
}

/**
 * Returns local-space bounding box min/max for a layer map with origin at the
 * bottom-south-west corner (min x, min y, min z) and extent `width × height × depth`.
 */
export function deriveLayerMapLocalBounds(layerMap: LayerMapData): {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
} {
  const p = parseLayerMapGrid(layerMap);
  if ("error" in p) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    };
  }
  const { width, depth, height } = p.grid;
  return {
    min: { x: 0, y: 0, z: 0 },
    max: { x: width - 1, y: height - 1, z: depth - 1 },
  };
}

/**
 * Estimates how many cells a layer map would affect (non–no-op voxels; upper bound for safety).
 */
export function estimateLayerMapBlockCount(layerMap: LayerMapData): number {
  const p = parseLayerMapGrid(layerMap);
  if ("error" in p) {
    return 0;
  }
  let n = 0;
  const { grid } = p;
  for (let ly = 0; ly < grid.height; ly++) {
    for (let lz = 0; lz < grid.depth; lz++) {
      for (let lx = 0; lx < grid.width; lx++) {
        const b = grid.getBlock(lx, ly, lz);
        if (b === LAYER_MAP_NOOP_BLOCK) {
          continue;
        }
        n++;
      }
    }
  }
  return n;
}

/**
 * Compiles a validated layer map into bridge commands using `batchSet` chunks.
 * Local `(0,0,0)` is the bottom-south-west corner; `origin` is that corner in world space.
 */
export function compileLayerMapToBridgeCommands(
  layerMap: LayerMapData,
  origin: { x: number; y: number; z: number },
): BridgeCommand[] {
  const p = parseLayerMapGrid(layerMap);
  if ("error" in p) {
    return [];
  }
  const { grid } = p;
  const blocks: BridgeBatchBlock[] = [];
  for (let ly = 0; ly < grid.height; ly++) {
    for (let lz = 0; lz < grid.depth; lz++) {
      for (let lx = 0; lx < grid.width; lx++) {
        const block = grid.getBlock(lx, ly, lz);
        if (block === LAYER_MAP_NOOP_BLOCK) {
          continue;
        }
        blocks.push({
          x: origin.x + lx,
          y: origin.y + ly,
          z: origin.z + lz,
          type: block,
        });
      }
    }
  }

  const commands: BridgeCommand[] = [];
  for (let i = 0; i < blocks.length; i += BATCH_SET_CHUNK) {
    commands.push({ kind: "batchSet", blocks: blocks.slice(i, i + BATCH_SET_CHUNK) });
  }
  return commands;
}

function parseLayerMapGrid(layerMap: LayerMapData): { grid: ParsedLayerGrid } | { error: string } {
  const { layers, palette } = layerMap;
  if (layers.length === 0) {
    return { error: "layerMap.layers must be non-empty" };
  }
  if (layers.length > LAYER_MAP_MAX_VERTICAL) {
    return {
      error: `layerMap has ${layers.length} layers; max is ${LAYER_MAP_MAX_VERTICAL}`,
    };
  }

  const resolvedPalette = new Map<string, string>();
  for (const [key, value] of Object.entries(palette)) {
    if (key.length !== 1) {
      return { error: `palette keys must be single characters; got key length ${key.length}` };
    }
    if (key === " ") {
      return {
        error:
          'palette must not use the space key `" "` — space in `layers` means no-op (leave block unchanged); use `"_"` for air in the grid',
      };
    }
    resolvedPalette.set(key, value);
  }
  if (!resolvedPalette.has(LAYER_MAP_AIR_CHAR)) {
    resolvedPalette.set(LAYER_MAP_AIR_CHAR, "minecraft:air");
  }

  const rowSets: string[][] = [];
  for (let i = 0; i < layers.length; i++) {
    const rows = splitLayerRows(layers[i]!);
    if (rows.length === 0) {
      return { error: `layer ${i} has no rows` };
    }
    if (rows.length > LAYER_MAP_MAX_HORIZONTAL) {
      return {
        error: `layer ${i} has ${rows.length} rows; max horizontal span is ${LAYER_MAP_MAX_HORIZONTAL}`,
      };
    }
    const w = [...rows[0]!].length;
    if (w > LAYER_MAP_MAX_HORIZONTAL) {
      return {
        error: `layer ${i} row width ${w} exceeds max ${LAYER_MAP_MAX_HORIZONTAL}`,
      };
    }
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      if ([...row].length !== w) {
        return {
          error: `layer ${i} has ragged row lengths (expected width ${w})`,
        };
      }
    }
    rowSets.push(rows);
  }

  const depth = rowSets[0]!.length;
  const width = [...rowSets[0]![0]!].length;
  for (let i = 1; i < rowSets.length; i++) {
    if (rowSets[i]!.length !== depth) {
      return { error: "all layers must have the same number of rows (depth)" };
    }
    if ([...rowSets[i]![0]!].length !== width) {
      return { error: "all layers must have the same row width" };
    }
  }

  const height = layers.length;

  const getBlock = (lx: number, ly: number, lz: number): string => {
    const layerFromTop = height - 1 - ly;
    const row = rowSets[layerFromTop]![lz]!;
    const chars = [...row];
    const ch = chars[lx];
    if (ch === undefined) {
      return LAYER_MAP_NOOP_BLOCK;
    }
    if (ch === " ") {
      return LAYER_MAP_NOOP_BLOCK;
    }
    const id = resolvedPalette.get(ch);
    if (id !== undefined) {
      return id;
    }
    return LAYER_MAP_NOOP_BLOCK;
  };

  for (let ly = 0; ly < height; ly++) {
    for (let lz = 0; lz < depth; lz++) {
      for (let lx = 0; lx < width; lx++) {
        const layerFromTop = height - 1 - ly;
        const row = rowSets[layerFromTop]![lz]!;
        const ch = [...row][lx]!;
        if (ch === " ") {
          continue;
        }
        if (!resolvedPalette.has(ch)) {
          return {
            error: `undefined character ${JSON.stringify(ch)} in layer map (add it to palette)`,
          };
        }
      }
    }
  }

  return {
    grid: {
      width,
      depth,
      height,
      getBlock,
    },
  };
}

function splitLayerRows(layer: string): string[] {
  const lines = layer.split(/\r?\n/);
  const trimmed = lines.filter((line, idx) => idx < lines.length - 1 || line.length > 0);
  return trimmed;
}
