import type { Plan, Point } from "./schema.js";

// ---------------------------------------------------------------------------
// Tower template
// ---------------------------------------------------------------------------

export type TowerParams = {
  /** World the tower is placed in. */
  world: string;
  /** Bottom-centre block of the tower. */
  anchor: Point;
  /** Height in blocks (1–16). */
  height: number;
  /** Side length of the square footprint in blocks (2–8). */
  width: number;
  /** Whether to hollow the column (walls only, no floor/ceiling). */
  hollow: boolean;
  /** Concrete block id or symbolic material slot for the tower body. */
  block: string;
};

/**
 * Compiles a tower template into a deterministic plan.
 *
 * Geometry and material are fully separated: the same params always produce
 * the same primitive sequence, and the `block` field accepts symbolic slots
 * so the material resolver can swap the palette without touching geometry.
 */
export function compileTowerTemplate(params: TowerParams): Plan {
  const { world, anchor, height, width, hollow, block } = params;

  // Compute exact corners: anchor is the bottom-centre, footprint is width×width.
  const half = Math.floor(width / 2);
  const fromX = anchor.x - half;
  const toX = anchor.x + (width - half - 1);
  const fromZ = anchor.z - half;
  const toZ = anchor.z + (width - half - 1);
  const fromY = anchor.y;
  const toY = anchor.y + height - 1;

  const from: Point = { x: fromX, y: fromY, z: fromZ };
  const to: Point = { x: toX, y: toY, z: toZ };

  const label = `${hollow ? "hollow " : ""}${width}×${width} tower, ${height} blocks tall`;

  return {
    intent: "build_tower",
    targetWorld: world,
    targetRegion: { world, min: from, max: to },
    assumptions: [`Deterministic template: ${label}, block: ${block}.`],
    passes: [
      {
        name: "tower_column",
        goal: `Build ${label}.`,
        primitives: [
          {
            type: hollow ? "hollow_cuboid" : "fill_cuboid",
            from,
            to,
            block,
          },
        ],
      },
    ],
    reply: `Building a ${height}-block ${hollow ? "hollow " : ""}tower.`,
    needsMoreInfo: false,
  };
}

// ---------------------------------------------------------------------------
// Cottage template
// ---------------------------------------------------------------------------

export type CottageParams = {
  /** World the cottage is placed in. */
  world: string;
  /**
   * Bottom-front-left corner of the cottage footprint (min X/Z, ground floor Y).
   */
  origin: Point;
  /** Width of the cottage footprint in blocks (interior + 2 walls). Minimum 5. */
  width: number;
  /** Depth of the cottage footprint in blocks (interior + 2 walls). Minimum 5. */
  depth: number;
  /** Wall height (floor to underside of roof), minimum 3. */
  wallHeight: number;
  /** Block for walls, floor, and ceiling. Accepts symbolic slots. */
  wallBlock: string;
  /** Block for the roof layer. Accepts symbolic slots. */
  roofBlock: string;
};

/**
 * Compiles a cottage template into a deterministic multi-pass plan.
 *
 * Pass order:
 * 1. Shell — hollow cuboid forming the four walls, floor, and ceiling.
 * 2. Roof — fill_cuboid one block above the shell ceiling.
 *
 * The interior is empty. Windows and doors are left to future decoration passes.
 */
export function compileCottageTemplate(params: CottageParams): Plan {
  const { world, origin, width, depth, wallHeight, wallBlock, roofBlock } = params;

  const shellFrom: Point = { x: origin.x, y: origin.y, z: origin.z };
  const shellTo: Point = {
    x: origin.x + width - 1,
    y: origin.y + wallHeight - 1,
    z: origin.z + depth - 1,
  };
  const roofY = origin.y + wallHeight;
  const roofFrom: Point = { x: origin.x, y: roofY, z: origin.z };
  const roofTo: Point = { x: origin.x + width - 1, y: roofY, z: origin.z + depth - 1 };

  const label = `${width}×${depth} cottage, ${wallHeight} blocks tall`;

  return {
    intent: "build_cottage",
    targetWorld: world,
    targetRegion: {
      world,
      min: shellFrom,
      max: roofTo,
    },
    assumptions: [`Deterministic template: ${label}.`],
    passes: [
      {
        name: "shell",
        goal: `Build ${label} shell (hollow walls, floor, ceiling).`,
        primitives: [
          { type: "hollow_cuboid", from: shellFrom, to: shellTo, block: wallBlock },
        ],
      },
      {
        name: "roof",
        goal: "Add flat roof slab.",
        primitives: [
          { type: "fill_cuboid", from: roofFrom, to: roofTo, block: roofBlock },
        ],
      },
    ],
    reply: `Building a ${width}×${depth} cottage.`,
    needsMoreInfo: false,
  };
}
