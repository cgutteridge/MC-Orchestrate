import type { LayerMapData } from "./layerMap.js";
import {
  LAYER_MAP_AIR_CHAR,
  LAYER_MAP_MAX_HORIZONTAL,
  LAYER_MAP_MAX_VERTICAL,
  validateLayerMapShape,
} from "./layerMap.js";
import { normalizeCuboid } from "./requestContext.js";
import type { Point, Primitive } from "./schema.js";

export type PrimitivesToLayerMapOptions = {
  /**
   * South-west-bottom corner of the exported grid in world space. When omitted,
   * the tight bounding box of all painted voxels is used (same as using the
   * minimum corner of that box).
   */
  origin?: Point;
};

export type PrimitivesToLayerMapResult =
  | { ok: true; layerMap: LayerMapData }
  | { ok: false; error: string };

const AIR = "minecraft:air";

function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function fillCuboid(map: Map<string, string>, from: Point, to: Point, block: string): void {
  const c = normalizeCuboid(from, to);
  for (let x = c.from.x; x <= c.to.x; x++) {
    for (let y = c.from.y; y <= c.to.y; y++) {
      for (let z = c.from.z; z <= c.to.z; z++) {
        map.set(voxelKey(x, y, z), block);
      }
    }
  }
}

function applyHollowCuboid(map: Map<string, string>, from: Point, to: Point, block: string): void {
  const cuboid = normalizeCuboid(from, to);
  const widthX = cuboid.to.x - cuboid.from.x + 1;
  const widthY = cuboid.to.y - cuboid.from.y + 1;
  const widthZ = cuboid.to.z - cuboid.from.z + 1;

  if (widthX <= 2 || widthY <= 2 || widthZ <= 2) {
    fillCuboid(map, cuboid.from, cuboid.to, block);
    return;
  }

  fillCuboid(map, cuboid.from, cuboid.to, block);
  fillCuboid(
    map,
    {
      x: cuboid.from.x + 1,
      y: cuboid.from.y + 1,
      z: cuboid.from.z + 1,
    },
    {
      x: cuboid.to.x - 1,
      y: cuboid.to.y - 1,
      z: cuboid.to.z - 1,
    },
    AIR,
  );
}

function applyCylinder(
  map: Map<string, string>,
  center: Point,
  radius: number,
  height: number,
  block: string,
  hollow: boolean,
  axis: "x" | "y" | "z",
): void {
  const radiusSquared = radius * radius;
  const innerSquared = (radius - 1) * (radius - 1);

  for (let a = -radius; a <= radius; a++) {
    for (let b = -radius; b <= radius; b++) {
      const distanceSquared = a * a + b * b;
      if (distanceSquared > radiusSquared) {
        continue;
      }
      if (hollow && distanceSquared < innerSquared) {
        continue;
      }

      for (let h = 0; h < height; h++) {
        const point =
          axis === "y"
            ? { x: center.x + a, y: center.y + h, z: center.z + b }
            : axis === "x"
              ? { x: center.x + h, y: center.y + a, z: center.z + b }
              : { x: center.x + a, y: center.y + b, z: center.z + h };
        map.set(voxelKey(point.x, point.y, point.z), block);
      }
    }
  }
}

function applyReplaceInRegion(
  map: Map<string, string>,
  from: Point,
  to: Point,
  fromBlock: string,
  toBlock: string,
): void {
  const c = normalizeCuboid(from, to);
  for (let x = c.from.x; x <= c.to.x; x++) {
    for (let y = c.from.y; y <= c.to.y; y++) {
      for (let z = c.from.z; z <= c.to.z; z++) {
        const k = voxelKey(x, y, z);
        const cur = map.get(k) ?? AIR;
        if (cur === fromBlock) {
          map.set(k, toBlock);
        }
      }
    }
  }
}

/**
 * Applies each primitive in order to a voxel map, matching {@link compilePlan}
 * semantics (later primitives overwrite earlier ones at the same coordinate).
 *
 * @param map Mutable map from `"x,y,z"` world keys to block id.
 * @param primitive One build primitive.
 */
export function applyPrimitiveToVoxelMap(map: Map<string, string>, primitive: Primitive): void {
  switch (primitive.type) {
    case "set_block":
      map.set(voxelKey(primitive.x, primitive.y, primitive.z), primitive.block);
      break;
    case "fill_cuboid":
      fillCuboid(map, primitive.from, primitive.to, primitive.block);
      break;
    case "clear_region":
      fillCuboid(map, primitive.from, primitive.to, AIR);
      break;
    case "replace_in_region":
      applyReplaceInRegion(
        map,
        primitive.from,
        primitive.to,
        primitive.fromBlock,
        primitive.toBlock,
      );
      break;
    case "hollow_cuboid":
      applyHollowCuboid(map, primitive.from, primitive.to, primitive.block);
      break;
    case "cylinder":
      applyCylinder(
        map,
        primitive.center,
        primitive.radius,
        primitive.height,
        primitive.block,
        primitive.hollow,
        primitive.axis,
      );
      break;
    default: {
      const _exhaustive: never = primitive;
      void _exhaustive;
    }
  }
}

/**
 * Builds a character layer map (`layers` + `palette`) from a list of primitives
 * so smoke tests and logs can compare AI primitive output against an
 * equivalent layer-map view. Painting order matches {@link compilePlan}.
 *
 * The grid is the tight axis-aligned bounding box of all non-air voxels (or
 * the box from `options.origin` through the voxel max when `origin` is set).
 * Coordinates are the same world-space integers the planner uses.
 *
 * @param primitives Primitives from one pass (no `layerMap` pass).
 * @param options Optional fixed origin (must be on or below the voxel min).
 */
export function primitivesToLayerMapData(
  primitives: readonly Primitive[],
  options?: PrimitivesToLayerMapOptions,
): PrimitivesToLayerMapResult {
  const map = new Map<string, string>();
  for (const p of primitives) {
    applyPrimitiveToVoxelMap(map, p);
  }

  if (map.size === 0) {
    return { ok: false, error: "primitivesToLayerMapData: no voxels produced" };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const key of map.keys()) {
    const [xs, ys, zs] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    const z = Number(zs);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const origin = options?.origin ?? { x: minX, y: minY, z: minZ };
  if (minX < origin.x || minY < origin.y || minZ < origin.z) {
    return {
      ok: false,
      error: `primitivesToLayerMapData: voxel min (${minX},${minY},${minZ}) is below options.origin (${origin.x},${origin.y},${origin.z})`,
    };
  }

  const width = maxX - origin.x + 1;
  const depth = maxZ - origin.z + 1;
  const height = maxY - origin.y + 1;

  if (width > LAYER_MAP_MAX_HORIZONTAL || depth > LAYER_MAP_MAX_HORIZONTAL) {
    return {
      ok: false,
      error: `primitivesToLayerMapData: footprint ${width}×${depth} exceeds max ${LAYER_MAP_MAX_HORIZONTAL}×${LAYER_MAP_MAX_HORIZONTAL}`,
    };
  }
  if (height > LAYER_MAP_MAX_VERTICAL) {
    return {
      ok: false,
      error: `primitivesToLayerMapData: height ${height} exceeds max ${LAYER_MAP_MAX_VERTICAL}`,
    };
  }

  const blockIds = new Set<string>();
  for (let wx = origin.x; wx <= maxX; wx++) {
    for (let wy = origin.y; wy <= maxY; wy++) {
      for (let wz = origin.z; wz <= maxZ; wz++) {
        const b = map.get(voxelKey(wx, wy, wz)) ?? AIR;
        blockIds.add(b);
      }
    }
  }

  const palette: Record<string, string> = { [LAYER_MAP_AIR_CHAR]: AIR };
  const charByBlock = new Map<string, string>([[AIR, LAYER_MAP_AIR_CHAR]]);
  const used = new Set<string>([LAYER_MAP_AIR_CHAR]);

  /** Reserved for air; never assign `_` from the pool to other materials. */
  const pool =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()-=+[]{}|;:,.<>?`~";

  let poolIndex = 0;
  const sortedIds = [...blockIds].sort();
  for (const block of sortedIds) {
    if (charByBlock.has(block)) {
      continue;
    }
    let ch: string | undefined;
    while (poolIndex < pool.length) {
      const c = pool[poolIndex++]!;
      if (!used.has(c)) {
        ch = c;
        break;
      }
    }
    if (ch === undefined) {
      let code = 0x4000;
      while (used.has(String.fromCodePoint(code))) {
        code++;
      }
      ch = String.fromCodePoint(code);
    }
    used.add(ch);
    charByBlock.set(block, ch);
    palette[ch] = block;
  }

  const layers: string[] = [];
  for (let j = 0; j < height; j++) {
    const wy = maxY - j;
    const rows: string[] = [];
    for (let lz = 0; lz < depth; lz++) {
      const wz = origin.z + lz;
      let row = "";
      for (let lx = 0; lx < width; lx++) {
        const wx = origin.x + lx;
        const block = map.get(voxelKey(wx, wy, wz)) ?? AIR;
        row += charByBlock.get(block) ?? "?";
      }
      rows.push(row);
    }
    layers.push(rows.join("\n"));
  }

  const layerMap: LayerMapData = { layers, palette };
  const shapeErr = validateLayerMapShape(layerMap);
  if (shapeErr !== undefined) {
    return { ok: false, error: `primitivesToLayerMapData: ${shapeErr}` };
  }

  return { ok: true, layerMap };
}

/**
 * Pretty-prints {@link primitivesToLayerMapData} as JSON for logs and smoke
 * scripts. On failure, returns a one-line error string (not JSON).
 *
 * @param primitives Primitives from one pass.
 * @param options Same as {@link primitivesToLayerMapData}.
 */
export function formatPrimitivesAsLayerMapJson(
  primitives: readonly Primitive[],
  options?: PrimitivesToLayerMapOptions,
): string {
  const result = primitivesToLayerMapData(primitives, options);
  if (!result.ok) {
    return result.error;
  }
  return JSON.stringify(result.layerMap, null, 2);
}
