import type { ChatCommandRequest } from "../types/plugin.js";
import type { Point, Region } from "./schema.js";

const KNOWN_BLOCKS = [
  "glass",
  "stone",
  "cobblestone",
  "oak_planks",
  "spruce_planks",
  "dirt",
] as const;

export function parseRequestedHeight(message: string): number | undefined {
  const match = message.match(/(\d+)\s*block/);
  if (!match) {
    return undefined;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(16, value)) : undefined;
}

export function parseRequestedBlock(message: string): string | undefined {
  const lowered = message.toLowerCase();
  const found = KNOWN_BLOCKS.find((candidate) =>
    lowered.includes(candidate.replace("_", " ")),
  );
  return found ? `minecraft:${found}` : undefined;
}

export function anchorPoint(
  request: ChatCommandRequest,
  distance: number,
): Point {
  return {
    x: Math.round(
      request.player.position.x + request.player.lookVector.x * distance,
    ),
    y: Math.round(request.player.position.y),
    z: Math.round(
      request.player.position.z + request.player.lookVector.z * distance,
    ),
  };
}

export function asBlock(position: { x: number; y: number; z: number }): Point {
  return {
    x: Math.round(position.x),
    y: Math.round(position.y),
    z: Math.round(position.z),
  };
}

export function defaultRegion(request: ChatCommandRequest): Region {
  const point = asBlock(request.player.position);
  return {
    world: request.player.world,
    min: point,
    max: point,
  };
}

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

export function normalizeRegion(region: Region): Region {
  const normalized = normalizeCuboid(region.min, region.max);
  return {
    world: region.world,
    min: normalized.from,
    max: normalized.to,
  };
}
