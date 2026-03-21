import type { ChatCommandRequest } from "../types/plugin.js";
import type { Point, Region } from "./schema.js";

const REPLACEABLE_TARGET_BLOCKS = new Set([
  "minecraft:air",
  "minecraft:short_grass",
  "minecraft:tall_grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:dead_bush",
  "minecraft:snow",
  "minecraft:vine",
  "minecraft:weeping_vines",
  "minecraft:twisting_vines",
  "minecraft:sunflower",
  "minecraft:lilac",
  "minecraft:rose_bush",
  "minecraft:peony",
  "minecraft:poppy",
  "minecraft:dandelion",
  "minecraft:blue_orchid",
  "minecraft:allium",
  "minecraft:azure_bluet",
  "minecraft:oxeye_daisy",
  "minecraft:cornflower",
  "minecraft:lily_of_the_valley",
  "minecraft:torchflower",
]);

/**
 * Extracts a requested block height from freeform player text when present.
 */
export function parseRequestedHeight(message: string): number | undefined {
  const match = message.match(/(\d+)\s*block/);
  if (!match) {
    return undefined;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(16, value)) : undefined;
}

/**
 * Computes a block anchor in front of the player based on their current look vector.
 */
export function anchorPoint(
  request: ChatCommandRequest,
  distance: number,
): Point {
  const direction = horizontalDirection(request);
  return {
    x: Math.round(request.player.position.x + direction.x * distance),
    y: Math.round(request.player.position.y),
    z: Math.round(request.player.position.z + direction.z * distance),
  };
}

/**
 * Picks a grounded anchor for structures, preferring the looked-at block when present.
 */
export function structureAnchorPoint(
  request: ChatCommandRequest,
  distance: number,
): Point {
  return structureCenterPoint(request, distance);
}

/**
 * Picks a centered anchor for structures, preferring the looked-at block when present.
 */
export function structureCenterPoint(
  request: ChatCommandRequest,
  distance: number,
): Point {
  const targetBlock = request.localContext.targetBlock;
  if (targetBlock && targetBlock.type !== "minecraft:air") {
    const yOffset = isReplaceableTargetBlock(targetBlock.type) ? 0 : 1;
    return {
      x: targetBlock.x,
      y: targetBlock.y + yOffset,
      z: targetBlock.z,
    };
  }

  const horizontalAnchor = anchorPoint(request, distance);
  return {
    x: horizontalAnchor.x,
    y: Math.floor(request.player.position.y),
    z: horizontalAnchor.z,
  };
}

/**
 * Picks the minimum corner for a rectangular footprint, centering on the looked-at
 * block when available and otherwise placing the footprint far enough ahead to stay
 * out of the player's occupied space.
 */
export function structureFootprintOrigin(
  request: ChatCommandRequest,
  width: number,
  depth: number,
  clearance = 2,
): Point {
  const center = structureCenterPoint(
    request,
    Math.max(
      clearance + Math.ceil(width / 2),
      clearance + Math.ceil(depth / 2),
    ),
  );

  return {
    x: center.x - Math.floor(width / 2),
    y: center.y,
    z: center.z - Math.floor(depth / 2),
  };
}

/**
 * Rounds a floating-point position into the block cell that contains it.
 */
export function asBlock(position: { x: number; y: number; z: number }): Point {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
  };
}

/**
 * Creates the smallest default target region centered on the speaking player.
 */
export function defaultRegion(request: ChatCommandRequest): Region {
  const point = asBlock(request.player.position);
  return {
    world: request.player.world,
    min: point,
    max: point,
  };
}

/**
 * Reorders cuboid corners so `from` is always the minimum point and `to` the maximum point.
 */
export function normalizeCuboid(from: Point, to: Point): {
  from: Point;
  to: Point;
} {
  return {
    from: {
      x: Math.min(from.x, to.x),
      y: Math.min(from.y, to.y),
      z: Math.min(from.z, to.z),
    },
    to: {
      x: Math.max(from.x, to.x),
      y: Math.max(from.y, to.y),
      z: Math.max(from.z, to.z),
    },
  };
}

/**
 * Returns a target region with normalized min/max bounds.
 */
export function normalizeRegion(region: Region): Region {
  const normalized = normalizeCuboid(region.min, region.max);
  return {
    world: region.world,
    min: normalized.from,
    max: normalized.to,
  };
}

function horizontalDirection(request: ChatCommandRequest): { x: number; z: number } {
  const { x, z } = request.player.lookVector;
  const magnitude = Math.hypot(x, z);
  if (magnitude >= 0.25) {
    return { x: x / magnitude, z: z / magnitude };
  }

  const yawRadians = ((request.player.yaw + 90) * Math.PI) / 180;
  return {
    x: Math.cos(yawRadians),
    z: Math.sin(yawRadians),
  };
}

function isReplaceableTargetBlock(blockType: string): boolean {
  return REPLACEABLE_TARGET_BLOCKS.has(blockType.toLowerCase());
}
