import type { BuildPass, Plan, Point } from "./schema.js";

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
// Bridge template
// ---------------------------------------------------------------------------

export type BridgeParams = {
  /** World the bridge is placed in. */
  world: string;
  /**
   * Min corner of the walkway floor slab.
   * The parser pre-computes this from the player's position and look direction.
   */
  walkwayFrom: Point;
  /** Max corner of the walkway floor slab. */
  walkwayTo: Point;
  /**
   * Horizontal axis the bridge spans along.
   * Used to determine which edges receive fence railings.
   */
  axis: "x" | "z";
  /** Whether to add fence railings on both long edges of the bridge. */
  railings: boolean;
  /** Block for the walkway floor. Accepts symbolic slots. */
  walkBlock: string;
  /** Block for the fence railings. Accepts symbolic slots. */
  railBlock: string;
};

/**
 * Compiles a bridge template into a deterministic plan.
 *
 * Pass order:
 * 1. Walkway — a single-block-thick floor slab.
 * 2. Railings (optional) — fence posts along both long edges, one block above
 *    the walkway. Only emitted when `railings` is true and the walkway is at
 *    least 3 blocks wide (enough room to walk between them).
 */
export function compileBridgeTemplate(params: BridgeParams): Plan {
  const { world, walkwayFrom, walkwayTo, axis, railings, walkBlock, railBlock } = params;

  const passes: Plan["passes"] = [
    {
      name: "walkway",
      goal: "Lay flat bridge walkway.",
      primitives: [{ type: "fill_cuboid", from: walkwayFrom, to: walkwayTo, block: walkBlock }],
    },
  ];

  const walkwayWidth =
    axis === "x"
      ? walkwayTo.z - walkwayFrom.z + 1
      : walkwayTo.x - walkwayFrom.x + 1;

  if (railings && walkwayWidth >= 3) {
    const railY = walkwayFrom.y + 1;
    const leftRail: Plan["passes"][number] = {
      name: "railing_left",
      goal: "Add left fence railing.",
      primitives: [
        axis === "x"
          ? {
              type: "fill_cuboid",
              from: { x: walkwayFrom.x, y: railY, z: walkwayFrom.z },
              to: { x: walkwayTo.x, y: railY, z: walkwayFrom.z },
              block: railBlock,
            }
          : {
              type: "fill_cuboid",
              from: { x: walkwayFrom.x, y: railY, z: walkwayFrom.z },
              to: { x: walkwayFrom.x, y: railY, z: walkwayTo.z },
              block: railBlock,
            },
      ],
    };
    const rightRail: Plan["passes"][number] = {
      name: "railing_right",
      goal: "Add right fence railing.",
      primitives: [
        axis === "x"
          ? {
              type: "fill_cuboid",
              from: { x: walkwayFrom.x, y: railY, z: walkwayTo.z },
              to: { x: walkwayTo.x, y: railY, z: walkwayTo.z },
              block: railBlock,
            }
          : {
              type: "fill_cuboid",
              from: { x: walkwayTo.x, y: railY, z: walkwayFrom.z },
              to: { x: walkwayTo.x, y: railY, z: walkwayTo.z },
              block: railBlock,
            },
      ],
    };
    passes.push(leftRail, rightRail);
  }

  const regionMax: Point = {
    x: walkwayTo.x,
    y: railings && walkwayWidth >= 3 ? walkwayFrom.y + 1 : walkwayFrom.y,
    z: walkwayTo.z,
  };

  return {
    intent: "build_bridge",
    targetWorld: world,
    targetRegion: { world, min: walkwayFrom, max: regionMax },
    assumptions: [`Deterministic bridge template, ${walkwayWidth} wide.`],
    passes,
    reply: `Building a ${walkwayTo[axis === "x" ? "x" : "z"] - walkwayFrom[axis === "x" ? "x" : "z"] + 1}-block bridge.`,
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

// ---------------------------------------------------------------------------
// Barn template
// ---------------------------------------------------------------------------

export type BarnParams = {
  /** World the barn is placed in. */
  world: string;
  /** Bottom-front-left corner of the barn footprint. */
  origin: Point;
  /** Width along the X axis (minimum 5, default 12). */
  width: number;
  /** Depth along the Z axis (minimum 5, default 8). Determines roof pitch. */
  depth: number;
  /** Wall height in blocks (minimum 3, default 4). */
  wallHeight: number;
  /** Block for the hollow walls. Accepts symbolic slots. */
  wallBlock: string;
  /** Block for the gabled roof layers. Accepts symbolic slots. */
  roofBlock: string;
};

/**
 * Compiles a barn template into a deterministic plan.
 *
 * Pass order:
 * 1. Walls — hollow cuboid forming four walls, floor, and ceiling.
 * 2. Gabled roof — a series of fill_cuboid layers that step inward by one
 *    block on each Z side per layer, producing a pitched A-frame roof.
 *    The ridge is the narrowest central slice.
 */
export function compileBarnTemplate(params: BarnParams): Plan {
  const { world, origin, width, depth, wallHeight, wallBlock, roofBlock } = params;

  const wallFrom: Point = { ...origin };
  const wallTo: Point = {
    x: origin.x + width - 1,
    y: origin.y + wallHeight - 1,
    z: origin.z + depth - 1,
  };

  const roofPass = buildGabledRoofPass(wallFrom, wallTo, roofBlock);

  const maxRoofY =
    roofPass.primitives.length > 0
      ? origin.y + wallHeight + roofPass.primitives.length - 1
      : wallTo.y;

  return {
    intent: "build_barn",
    targetWorld: world,
    targetRegion: {
      world,
      min: wallFrom,
      max: { x: wallTo.x, y: maxRoofY, z: wallTo.z },
    },
    assumptions: [
      `Deterministic barn template: ${width}×${depth} footprint, ${wallHeight}-block walls, ${roofPass.primitives.length}-layer gabled roof.`,
    ],
    passes: [
      {
        name: "walls",
        goal: `Build ${width}×${depth} barn shell (hollow walls, floor, ceiling).`,
        primitives: [
          { type: "hollow_cuboid", from: wallFrom, to: wallTo, block: wallBlock },
        ],
      },
      roofPass,
    ],
    reply: `Building a ${width}×${depth} barn.`,
    needsMoreInfo: false,
  };
}

/**
 * Builds a single multi-primitive pass for a gabled (A-frame) roof above a
 * given wall box. Each layer steps one block inward on both Z sides per Y
 * level, producing a triangular cross-section when viewed from the ends.
 */
function buildGabledRoofPass(wallFrom: Point, wallTo: Point, block: string): BuildPass {
  const primitives: BuildPass["primitives"] = [];
  const wallTopY = wallTo.y;

  for (let layer = 0; ; layer++) {
    const y = wallTopY + 1 + layer;
    const zFrom = wallFrom.z + layer + 1;
    const zTo = wallTo.z - layer - 1;
    if (zFrom > zTo) {
      break;
    }
    primitives.push({
      type: "fill_cuboid",
      from: { x: wallFrom.x, y, z: zFrom },
      to: { x: wallTo.x, y, z: zTo },
      block,
    });
  }

  return {
    name: "gabled_roof",
    goal: "Build A-frame gabled roof.",
    primitives: primitives.length > 0 ? primitives : [
      // Fallback: flat cap if depth is too small to pitch
      {
        type: "fill_cuboid",
        from: { x: wallFrom.x, y: wallTopY + 1, z: wallFrom.z },
        to: { x: wallTo.x, y: wallTopY + 1, z: wallTo.z },
        block,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Gazebo template
// ---------------------------------------------------------------------------

export type GazeboParams = {
  /** World the gazebo is placed in. */
  world: string;
  /** Centre of the gazebo at ground-floor level. */
  center: Point;
  /** Radius of the platform ring in blocks (2–5, default 4). */
  radius: number;
  /** Height of the support posts in blocks (3–5, default 4). */
  postHeight: number;
  /** Block for the platform ring and inner floor. Accepts symbolic slots. */
  platformBlock: string;
  /** Block for the four vertical posts. Accepts symbolic slots. */
  postBlock: string;
  /** Block for the solid roof cap. Accepts symbolic slots. */
  roofBlock: string;
};

/**
 * Compiles a gazebo template into a deterministic plan.
 *
 * Pass order:
 * 1. Platform ring — hollow cylinder at ground level (the edge surround).
 * 2. Posts — four vertical fill_cuboids at N/S/E/W positions on the ring edge.
 * 3. Roof cap — solid cylinder disc at the top of the posts.
 */
export function compileGazeboTemplate(params: GazeboParams): Plan {
  const { world, center, radius, postHeight, platformBlock, postBlock, roofBlock } = params;

  const roofY = center.y + postHeight + 1;

  const posts: BuildPass["primitives"] = [
    {
      type: "fill_cuboid",
      from: { x: center.x, y: center.y + 1, z: center.z + radius },
      to: { x: center.x, y: center.y + postHeight, z: center.z + radius },
      block: postBlock,
    },
    {
      type: "fill_cuboid",
      from: { x: center.x, y: center.y + 1, z: center.z - radius },
      to: { x: center.x, y: center.y + postHeight, z: center.z - radius },
      block: postBlock,
    },
    {
      type: "fill_cuboid",
      from: { x: center.x + radius, y: center.y + 1, z: center.z },
      to: { x: center.x + radius, y: center.y + postHeight, z: center.z },
      block: postBlock,
    },
    {
      type: "fill_cuboid",
      from: { x: center.x - radius, y: center.y + 1, z: center.z },
      to: { x: center.x - radius, y: center.y + postHeight, z: center.z },
      block: postBlock,
    },
  ];

  return {
    intent: "build_gazebo",
    targetWorld: world,
    targetRegion: {
      world,
      min: { x: center.x - radius, y: center.y, z: center.z - radius },
      max: { x: center.x + radius, y: roofY, z: center.z + radius },
    },
    assumptions: [
      `Deterministic gazebo template: radius ${radius}, ${postHeight}-block posts.`,
    ],
    passes: [
      {
        name: "platform",
        goal: "Build circular platform ring.",
        primitives: [
          {
            type: "cylinder",
            center: { x: center.x, y: center.y, z: center.z },
            radius,
            height: 1,
            block: platformBlock,
            hollow: true,
            axis: "y",
          },
        ],
      },
      {
        name: "posts",
        goal: "Add four cardinal support posts.",
        primitives: posts,
      },
      {
        name: "roof_cap",
        goal: "Add solid cylinder roof cap.",
        primitives: [
          {
            type: "cylinder",
            center: { x: center.x, y: roofY, z: center.z },
            radius,
            height: 1,
            block: roofBlock,
            hollow: false,
            axis: "y",
          },
        ],
      },
    ],
    reply: `Building a gazebo with radius ${radius}.`,
    needsMoreInfo: false,
  };
}
