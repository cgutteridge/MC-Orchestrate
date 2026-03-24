import type { BridgeBatchBlock, BridgeCommand } from "../bridge/types.js";

/**
 * Layer map payload: bottom-to-top Y slices + character → block id palette.
 * `layers[0]` is the **bottom** slice (lowest local Y); `layers[length-1]` is the top.
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

/**
 * Footprint for {@link normalizeLayerMap}: same meaning as the design-step `desiredSize`
 * (`DesiredSizeSchema`) — width = columns (+X), depth = rows per slice (+Z), height = Y slice count
 * (layers bottom→top: first string is the lowest Y slice).
 */
export type LayerMapClip = {
  width: number;
  depth: number;
  height: number;
};

/**
 * Rectangularizes ragged layer maps, fixes palette quirks, and maps unknown
 * characters to no-op spaces.
 *
 * When `clip` is set (from the design-step `desiredSize`), pads with spaces or
 * truncates so the grid matches that footprint exactly.
 *
 * When `clip` is omitted, rectangularizes to a common width/depth/height and
 * only then applies hard caps {@link LAYER_MAP_MAX_HORIZONTAL} /
 * {@link LAYER_MAP_MAX_VERTICAL} so parsing still succeeds.
 *
 * @param layerMap - Raw AI or repaired layer map.
 * @param clip - Optional sizing from the design step; when set, overrides intrinsic extent.
 */
export function normalizeLayerMap(layerMap: LayerMapData, clip?: LayerMapClip): LayerMapData {
  const palette: Record<string, string> = { ...layerMap.palette };
  delete palette[" "];

  const cleanedPalette: Record<string, string> = {};
  for (const [key, value] of Object.entries(palette)) {
    if (key.length !== 1) {
      continue;
    }
    cleanedPalette[key] = value;
  }
  if (!Object.prototype.hasOwnProperty.call(cleanedPalette, LAYER_MAP_AIR_CHAR)) {
    cleanedPalette[LAYER_MAP_AIR_CHAR] = "minecraft:air";
  }

  const paletteChars = new Set(Object.keys(cleanedPalette));

  let layerStrings = [...layerMap.layers];
  if (layerStrings.length === 0) {
    return { layers: layerStrings, palette: cleanedPalette };
  }

  if (!clip && layerStrings.length > LAYER_MAP_MAX_VERTICAL) {
    layerStrings = layerStrings.slice(0, LAYER_MAP_MAX_VERTICAL);
  }

  const rowSets: string[][] = [];
  for (let i = 0; i < layerStrings.length; i++) {
    let rows = splitLayerRows(layerStrings[i]!);
    if (rows.length === 0) {
      rows = [" "];
    }
    rowSets.push(rows);
  }

  let intrinsicW = 0;
  for (const rows of rowSets) {
    for (const row of rows) {
      intrinsicW = Math.max(intrinsicW, [...row].length);
    }
  }

  let intrinsicD = 0;
  for (const rows of rowSets) {
    intrinsicD = Math.max(intrinsicD, rows.length);
  }

  intrinsicW = Math.max(1, intrinsicW);
  intrinsicD = Math.max(1, intrinsicD);

  let maxW: number;
  let maxD: number;
  let targetLayerCount: number;

  if (clip) {
    maxW = clip.width;
    maxD = clip.depth;
    targetLayerCount = clip.height;
  } else {
    maxW = Math.max(1, Math.min(intrinsicW, LAYER_MAP_MAX_HORIZONTAL));
    maxD = Math.max(1, Math.min(intrinsicD, LAYER_MAP_MAX_HORIZONTAL));
    targetLayerCount = Math.min(rowSets.length, LAYER_MAP_MAX_VERTICAL);
  }

  const padToWidth = (row: string, w: number): string => {
    const chars = [...row];
    const slice = chars.slice(0, w);
    if (slice.length < w) {
      return slice.join("") + " ".repeat(w - slice.length);
    }
    return slice.join("");
  };

  const cleanRow = (row: string): string => {
    return [...row]
      .map((ch) => {
        if (ch === " ") {
          return ch;
        }
        if (ch === LAYER_MAP_AIR_CHAR) {
          return ch;
        }
        if (paletteChars.has(ch)) {
          return ch;
        }
        return " ";
      })
      .join("");
  };

  /** Rectangularize each layer to intrinsic unified maxW/maxD (ragged fix), then clip to maxW/maxD. */
  const rectangularLayers: string[][] = [];
  for (let li = 0; li < rowSets.length; li++) {
    let rows = rowSets[li]!.map((row) => cleanRow(padToWidth(row, intrinsicW)));
    rows = rows.slice(0, intrinsicD);
    while (rows.length < intrinsicD) {
      rows.push(" ".repeat(intrinsicW));
    }
    for (let r = 0; r < rows.length; r++) {
      rows[r] = cleanRow(padToWidth(rows[r]!, intrinsicW));
    }
    rectangularLayers.push(rows);
  }

  /** Truncate or pad layers to targetLayerCount; each slice to maxD × maxW. */
  const working = rectangularLayers.slice(0, targetLayerCount);
  while (working.length < targetLayerCount) {
    working.push(Array.from({ length: intrinsicD }, () => " ".repeat(intrinsicW)));
  }

  const normalizedLayers: string[] = [];
  for (let li = 0; li < working.length; li++) {
    let rows = working[li]!.map((row) => cleanRow(padToWidth(row, maxW)));
    rows = rows.slice(0, maxD);
    while (rows.length < maxD) {
      rows.push(" ".repeat(maxW));
    }
    for (let r = 0; r < rows.length; r++) {
      rows[r] = cleanRow(padToWidth(rows[r]!, maxW));
    }
    normalizedLayers.push(rows.join("\n"));
  }

  return {
    layers: normalizedLayers,
    palette: cleanedPalette,
  };
}

export type ParsedLayerGrid = {
  width: number;
  depth: number;
  height: number;
  /** Local Y: 0 = bottom slice; `height - 1` = top slice (matches `layers` order). */
  getBlock: (lx: number, ly: number, lz: number) => string;
};

/**
 * Validates shape and palette coverage for a layer map. Layers are ordered
 * **bottom → top**: `layers[0]` is the bottom slice (lowest Y), `layers[last]`
 * is the top slice (highest Y). Each layer is newline-separated **rows**; each
 * row is **columns** left-to-right (increasing X). Row index increases with Z.
 *
 * @returns `undefined` when valid, otherwise a human-readable error message.
 */
export function validateLayerMapShape(layerMap: LayerMapData): string | undefined {
  const parsed = parseLayerMapGrid(normalizeLayerMap(layerMap));
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
  const p = parseLayerMapGrid(normalizeLayerMap(layerMap));
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
 * Estimates how many cells a layer map would affect (non–no-op voxels).
 */
export function estimateLayerMapBlockCount(layerMap: LayerMapData): number {
  const p = parseLayerMapGrid(normalizeLayerMap(layerMap));
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
  const p = parseLayerMapGrid(normalizeLayerMap(layerMap));
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
    const row = rowSets[ly]![lz]!;
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
        const row = rowSets[ly]![lz]!;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Returns true when `value` looks like a bare step-3 {@link LayerMapData} payload
 * (`layers` + `palette` only), with no `passes` wrapper.
 *
 * @param value Parsed JSON object from the assistant.
 */
export function looksLikeBareLayerMapPayload(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.layers) &&
    value.layers.length > 0 &&
    typeof value.layers[0] === "string" &&
    isRecord(value.palette)
  );
}

/**
 * Pulls {@link LayerMapData} from common assistant shapes: top-level `layers`/`palette`,
 * nested `layerMap`, or legacy `passes[0].layerMap`.
 *
 * @param value Parsed JSON object (possibly a loose plan or build wrapper).
 * @returns Layer map data when found, otherwise `undefined`.
 */
export function tryExtractLayerMapData(value: Record<string, unknown>): LayerMapData | undefined {
  if (looksLikeBareLayerMapPayload(value)) {
    return {
      layers: value.layers as string[],
      palette: value.palette as Record<string, string>,
    };
  }
  if (typeof value.action === "string" && value.action === "build" && isRecord(value.plan)) {
    return tryExtractLayerMapData(value.plan);
  }
  if (isRecord(value.plan) && looksLikeBareLayerMapPayload(value.plan)) {
    return tryExtractLayerMapData(value.plan);
  }
  if (Array.isArray(value.passes) && value.passes.length > 0) {
    const first = value.passes[0];
    if (isRecord(first) && isRecord(first.layerMap) && Array.isArray(first.layerMap.layers)) {
      return {
        layers: first.layerMap.layers as string[],
        palette: isRecord(first.layerMap.palette) ? (first.layerMap.palette as Record<string, string>) : {},
      };
    }
  }
  return undefined;
}

/**
 * Converts a bare layer-map object or `{ layerMap: {...} }` into a loose plan-shaped
 * object with a single synthetic `passes` entry for the planner’s repair step.
 * No-op when `passes` is already an array.
 *
 * @param candidate Parsed plan object (possibly missing `passes`).
 */
export function coerceAssistantLayerMapToLoosePlanCandidate(
  candidate: Record<string, unknown>,
): Record<string, unknown> {
  if (Array.isArray(candidate.passes)) {
    return candidate;
  }
  const layerMap = extractLayerMapFields(candidate);
  if (!layerMap) {
    return candidate;
  }
  const { layers: _omitL, palette: _omitP, layerMap: _omitLm, ...rest } = candidate;
  return {
    ...rest,
    passes: [{ layerMap }],
  };
}

function extractLayerMapFields(obj: Record<string, unknown>): LayerMapData | undefined {
  if (Array.isArray(obj.layers) && isRecord(obj.palette)) {
    return {
      layers: obj.layers as string[],
      palette: obj.palette as Record<string, string>,
    };
  }
  if (isRecord(obj.layerMap) && Array.isArray((obj.layerMap as { layers: unknown }).layers)) {
    const lm = obj.layerMap as LayerMapData;
    return {
      layers: lm.layers,
      palette: isRecord(lm.palette) ? lm.palette : {},
    };
  }
  return undefined;
}
