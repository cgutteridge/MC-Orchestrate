import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { computePlacementAlignmentPoint, resolvePlacement, shiftPlan } from "./placement.js";
import type { Placement, Plan } from "./schema.js";

function makeRequest(
  position: { x: number; y: number; z: number },
  lookVector: { x: number; y: number; z: number },
  targetBlock?: { x: number; y: number; z: number; type: string },
): ChatCommandRequest {
  return {
    requestId: "test",
    player: {
      uuid: "u1",
      name: "Player",
      world: "world",
      position,
      yaw: 0,
      pitch: 0,
      lookVector,
    },
    message: "",
    recentMessages: [],
    localContext: { targetBlock, nearbyBlocks: [], nearbyEntities: [], nearbyPlayers: [] },
    serverContext: { timestamp: "2026-01-01T00:00:00Z", dimension: "NORMAL", onlinePlayerCount: 1 },
  };
}

const defaultPlacement: Placement = {
  ref: "player",
  frame: "player",
  offset: { F: 0, R: 0, N: 0, E: 0, UP: 0 },
  verticalReference: "on_ground",
};

describe("resolvePlacement — player frame", () => {
  it("no offsets returns player XZ at head Y (feet+1)", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement(defaultPlacement, req);
    expect(result).toEqual({ x: 0, y: 65, z: 0 });
  });

  it("F:+8 facing south (+z) increases z by 8", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement(
      { ...defaultPlacement, offset: { ...defaultPlacement.offset, F: 8 } },
      req,
    );
    expect(result).toEqual({ x: 0, y: 65, z: 8 });
  });

  it("R:-8 facing south (+z) moves east (+x)", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement(
      { ...defaultPlacement, offset: { ...defaultPlacement.offset, R: -8 } },
      req,
    );
    expect(result).toEqual({ x: 8, y: 65, z: 0 });
  });

  it("UP:-3 subtracts 3 from head Y", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement(
      { ...defaultPlacement, offset: { ...defaultPlacement.offset, UP: -3 } },
      req,
    );
    expect(result).toEqual({ x: 0, y: 62, z: 0 });
  });
});

describe("resolvePlacement — world frame", () => {
  it("N:+10 decreases z by 10", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement(
      { ...defaultPlacement, frame: "world", offset: { ...defaultPlacement.offset, N: 10 } },
      req,
    );
    expect(result).toEqual({ x: 0, y: 65, z: -10 });
  });

  it("E:+8, N:+8 reaches northeast", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement(
      {
        ...defaultPlacement,
        frame: "world",
        offset: { ...defaultPlacement.offset, E: 8, N: 8 },
      },
      req,
    );
    expect(result).toEqual({ x: 8, y: 65, z: -8 });
  });
});

describe("resolvePlacement — focus", () => {
  it("no offsets anchors at targetBlock XZ, top-of-block Y", () => {
    const req = makeRequest(
      { x: 0, y: 64, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 5, y: 63, z: 10, type: "minecraft:stone" },
    );
    const result = resolvePlacement({ ...defaultPlacement, ref: "focus" }, req);
    expect(result).toEqual({ x: 5, y: 64, z: 10 });
  });

  it("falls back to player when targetBlock is missing", () => {
    const req = makeRequest({ x: 0, y: 64, z: 0 }, { x: 0, y: 0, z: 1 });
    const result = resolvePlacement({ ...defaultPlacement, ref: "focus" }, req);
    expect(result).toEqual({ x: 0, y: 65, z: 0 });
  });
});

describe("computePlacementAlignmentPoint", () => {
  const plan: Plan = {
    intent: "t",
    targetWorld: "world",
    targetRegion: {
      world: "world",
      min: { x: 0, y: 10, z: 0 },
      max: { x: 4, y: 14, z: 4 },
    },
    assumptions: [],
    passes: [],
    reply: "",
    briefFulfilment: "Alignment point tests.",
  };

  it("flying uses vertical centre Y on the footprint", () => {
    const p = computePlacementAlignmentPoint(plan, {
      ...defaultPlacement,
      verticalReference: "flying",
    });
    expect(p).toEqual({ x: 2, y: 12, z: 2 });
  });

  it("under_ground uses max Y (top face of volume)", () => {
    const p = computePlacementAlignmentPoint(plan, {
      ...defaultPlacement,
      verticalReference: "under_ground",
    });
    expect(p).toEqual({ x: 2, y: 14, z: 2 });
  });

  it("on_ground uses min Y (bottom face of volume)", () => {
    const p = computePlacementAlignmentPoint(plan, {
      ...defaultPlacement,
      verticalReference: "on_ground",
    });
    expect(p).toEqual({ x: 2, y: 10, z: 2 });
  });
});

const basePlan: Plan = {
  intent: "build_tower",
  targetWorld: "world",
  targetRegion: { world: "world", min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 8, z: 2 } },
  assumptions: [],
  passes: [
    {
      name: "walls",
      goal: "Build walls.",
      layerMap: {
        layers: ["SSSSS", "SSSSS", "SSSSS", "SSSSS", "SSSSS"],
        palette: { S: "minecraft:stone", _: "minecraft:air" },
      },
    },
  ],
  reply: "Built.",
  briefFulfilment: "Tower shell matches fixture.",
};

describe("shiftPlan", () => {
  it("shifts targetRegion by the offset and preserves layer map data", () => {
    const shifted = shiftPlan(basePlan, { x: 10, y: 64, z: 20 });
    expect(shifted.passes[0]?.layerMap).toEqual(basePlan.passes[0]?.layerMap);
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
