import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { resolvePlacement, shiftPlan } from "./placement.js";
import type { Placement, Plan } from "./schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequest(
  position: { x: number; y: number; z: number },
  lookVector: { x: number; y: number; z: number },
  targetBlock?: { x: number; y: number; z: number; type: string },
): ChatCommandRequest {
  return {
    requestId: "test",
    player: {
      uuid: "u1", name: "Player", world: "world",
      position, yaw: 0, pitch: 0, lookVector,
    },
    message: "",
    recentMessages: [],
    localContext: { targetBlock, nearbyBlocks: [], nearbyEntities: [], nearbyPlayers: [] },
    serverContext: { timestamp: "2026-01-01T00:00:00Z", dimension: "NORMAL", onlinePlayerCount: 1 },
  };
}

const defaultPlacement: Placement = {
  ref: "player_view", forward: 0, back: 0, left: 0, right: 0,
  north: 0, south: 0, east: 0, west: 0, up: 0, down: 0,
};

// ---------------------------------------------------------------------------
// player_view
// ---------------------------------------------------------------------------

describe("resolvePlacement — player_view", () => {
  it("no offsets returns player XZ at ground Y", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement(defaultPlacement, req);
    expect(result).toEqual({ x: 0, y: 64, z: 0 });
  });

  it("forward:8 facing south (+z) → z increases by 8", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, forward: 8 }, req);
    expect(result).toEqual({ x: 0, y: 64, z: 8 });
  });

  it("forward:8 facing east (+x) → x increases by 8", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 1, y: 0, z: 0 });
    const result = resolvePlacement({ ...defaultPlacement, forward: 8 }, req);
    expect(result).toEqual({ x: 8, y: 64, z: 0 });
  });

  it("left:8 facing south → east (+x) by 8", () => {
    // Facing south (+z): left = east (+x).
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, left: 8 }, req);
    expect(result).toEqual({ x: 8, y: 64, z: 0 });
  });

  it("right:8 facing south → west (−x) by 8", () => {
    // Facing south (+z): right = west (−x).
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, right: 8 }, req);
    expect(result).toEqual({ x: -8, y: 64, z: 0 });
  });

  it("left:8 facing east → north (−z) by 8", () => {
    // Facing east (+x): left = north (−z).
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 1, y: 0, z: 0 });
    const result = resolvePlacement({ ...defaultPlacement, left: 8 }, req);
    expect(result).toEqual({ x: 0, y: 64, z: -8 });
  });

  it("up:5 adds 5 to ground Y", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, up: 5 }, req);
    expect(result).toEqual({ x: 0, y: 69, z: 0 });
  });

  it("down:3 subtracts 3 from ground Y", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, down: 3 }, req);
    expect(result).toEqual({ x: 0, y: 61, z: 0 });
  });

  it("combines forward, left, and up correctly", () => {
    // Facing south (nhx=0, nhz=1): forward:5 → z+5; left:3 → x+3; up:4 → y+4.
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, forward: 5, left: 3, up: 4 }, req);
    expect(result).toEqual({ x: 3, y: 68, z: 5 });
  });
});

// ---------------------------------------------------------------------------
// player_absolute
// ---------------------------------------------------------------------------

describe("resolvePlacement — player_absolute", () => {
  it("north:10 → z decreases by 10", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, ref: "player_absolute", north: 10 }, req);
    expect(result).toEqual({ x: 0, y: 64, z: -10 });
  });

  it("east:8, north:8 → NE diagonal", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, ref: "player_absolute", north: 8, east: 8 }, req);
    expect(result).toEqual({ x: 8, y: 64, z: -8 });
  });

  it("west:5 → x decreases by 5", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, ref: "player_absolute", west: 5 }, req);
    expect(result).toEqual({ x: -5, y: 64, z: 0 });
  });

  it("down:3 for a pit", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, ref: "player_absolute", down: 3 }, req);
    expect(result).toEqual({ x: 0, y: 61, z: 0 });
  });
});

// ---------------------------------------------------------------------------
// focus
// ---------------------------------------------------------------------------

describe("resolvePlacement — focus", () => {
  it("no offsets anchors at targetBlock XZ, ground Y", () => {
    const req = makeRequest(
      { x: 0, y: 64, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 5, y: 63, z: 10, type: "minecraft:stone" },
    );
    const result = resolvePlacement({ ...defaultPlacement, ref: "focus" }, req);
    expect(result).toEqual({ x: 5, y: 64, z: 10 });
  });

  it("up:10 above a focus block", () => {
    const req = makeRequest(
      { x: 0, y: 64, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 5, y: 63, z: 10, type: "minecraft:stone" },
    );
    const result = resolvePlacement({ ...defaultPlacement, ref: "focus", up: 10 }, req);
    expect(result).toEqual({ x: 5, y: 74, z: 10 });
  });

  it("falls back to player XZ when no targetBlock", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, ref: "focus" }, req);
    expect(result).toEqual({ x: 0, y: 64, z: 0 });
  });
});

// ---------------------------------------------------------------------------
// last_build
// ---------------------------------------------------------------------------

describe("resolvePlacement — last_build", () => {
  it("uses the last build centre with no offsets", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const lastCenter = { x: 10, y: 68, z: 20 };
    const result = resolvePlacement({ ...defaultPlacement, ref: "last_build" }, req, lastCenter);
    expect(result).toEqual({ x: 10, y: 64, z: 20 });
  });

  it("falls back to player XZ when no last build", () => {
    const req = makeRequest({ x: 5, y: 64, z: 5 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, ref: "last_build" }, req);
    expect(result).toEqual({ x: 5, y: 64, z: 5 });
  });
});

// ---------------------------------------------------------------------------
// shiftPlan
// ---------------------------------------------------------------------------

const basePlan: Plan = {
  intent: "build_tower",
  targetWorld: "world",
  targetRegion: { world: "world", min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 8, z: 2 } },
  assumptions: [],
  passes: [
    {
      name: "walls",
      goal: "Build walls.",
      primitives: [
        { type: "hollow_cuboid", from: { x: -2, y: 0, z: -2 }, to: { x: 2, y: 8, z: 2 }, block: "minecraft:stone" },
        { type: "set_block", x: 0, y: 4, z: 0, block: "minecraft:torch" },
        { type: "cylinder", center: { x: 0, y: 9, z: 0 }, radius: 3, height: 2, block: "minecraft:stone", hollow: false, axis: "y" },
      ],
    },
  ],
  reply: "Built.",
  needsMoreInfo: false,
};

describe("shiftPlan", () => {
  it("shifts all primitive coordinates by the offset", () => {
    const shifted = shiftPlan(basePlan, { x: 10, y: 64, z: 20 });
    const [pass] = shifted.passes;
    const [hollow, setBlock, cylinder] = pass!.primitives;

    expect(hollow).toMatchObject({ type: "hollow_cuboid", from: { x: 8, y: 64, z: 18 }, to: { x: 12, y: 72, z: 22 } });
    expect(setBlock).toMatchObject({ type: "set_block", x: 10, y: 68, z: 20 });
    expect(cylinder).toMatchObject({ type: "cylinder", center: { x: 10, y: 73, z: 20 } });
  });

  it("shifts targetRegion by the offset", () => {
    const shifted = shiftPlan(basePlan, { x: 10, y: 64, z: 20 });
    expect(shifted.targetRegion.min).toEqual({ x: 8, y: 64, z: 18 });
    expect(shifted.targetRegion.max).toEqual({ x: 12, y: 72, z: 22 });
  });

  it("does not mutate the original plan", () => {
    const originalMin = { ...basePlan.targetRegion.min };
    shiftPlan(basePlan, { x: 100, y: 100, z: 100 });
    expect(basePlan.targetRegion.min).toEqual(originalMin);
  });
});
