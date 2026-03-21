import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { Plan } from "./schema.js";
import { buildHeuristicPlan } from "./heuristicPlanner.js";

const baseRequest: ChatCommandRequest = {
  requestId: "req-1",
  player: {
    uuid: "u1",
    name: "cjg",
    world: "world",
    position: { x: -51, y: 113, z: -19 },
    yaw: 0,
    pitch: 0,
    lookVector: { x: 0, y: 0, z: 1 },
  },
  message: "",
  recentMessages: [],
  localContext: {
    targetBlock: {
      x: -51,
      y: 113,
      z: -17,
      type: "minecraft:oak_log",
    },
    nearbyBlocks: [],
    nearbyEntities: [],
    nearbyPlayers: [],
  },
  serverContext: {
    timestamp: "2026-03-21T18:00:00Z",
    dimension: "minecraft:overworld",
    onlinePlayerCount: 1,
  },
};

describe("buildHeuristicPlan", () => {
  it("builds a tower plan from a direct request", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "make me a 5 block stone tower here",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan?.intent).toBe("build_tower");
    expect(plan?.passes).toHaveLength(1);
    expect(plan?.reply).toContain("5-block tower");
  });

  it("builds a remove tree plan when the player is looking at a tree", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "delete this tree",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan?.intent).toBe("remove_tree");
    expect(plan?.passes.length).toBeGreaterThan(0);
  });

  it("builds a multi-pass house plan", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "make me a house here",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan?.intent).toBe("build_house");
    expect(plan?.passes.map((pass) => pass.name)).toEqual([
      "site_prep",
      "foundation",
      "walls",
      "openings",
      "roof",
    ]);
    expect(plan?.targetRegion.min).toEqual({ x: -54, y: 114, z: -20 });
    expect(plan?.targetRegion.max).toEqual({ x: -48, y: 120, z: -14 });
  });

  it("returns undefined for unsupported requests", () => {
    // arrange
    const request = {
      ...baseRequest,
      message: "write me a poem",
    };

    // act
    const plan = buildHeuristicPlan(request);

    // assert
    expect(plan).toBeUndefined();
  });

  it("handles tower follow-ups like 'make it taller' using recent context", () => {
    const request = {
      ...baseRequest,
      message: "make it taller by 2",
      recentMessages: ["build a tower from wool"],
      localContext: {
        ...baseRequest.localContext,
        targetBlock: {
          x: -51,
          y: 113,
          z: -17,
          type: "minecraft:short_grass",
        },
      },
    };

    const plan = buildHeuristicPlan(request);

    expect(plan?.intent).toBe("build_tower");
    expect(plan?.reply).toContain("2 blocks taller");
    expect(plan?.targetRegion.min).toEqual({ x: -51, y: 113, z: -17 });
    expect(plan?.targetRegion.max).toEqual({ x: -51, y: 119, z: -17 });
    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      type: "fill_cuboid",
      block: "minecraft:white_wool",
    });
  });

  it("asks for clarification when 'taller' has no tower context", () => {
    const request = {
      ...baseRequest,
      message: "make it taller by 2",
      recentMessages: [],
      localContext: {
        ...baseRequest.localContext,
        targetBlock: undefined,
      },
    };

    const plan = buildHeuristicPlan(request);

    expect(plan?.intent).toBe("unknown");
    expect(plan?.needsMoreInfo).toBe(true);
    expect(plan?.passes).toEqual([]);
    expect(plan?.clarification).toContain("structure context");
  });

  it("extends the previously executed tower footprint when available", () => {
    const request = {
      ...baseRequest,
      message: "make it taller by 2",
      recentMessages: [],
    };
    const previousPlan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -51, y: 113, z: -17 },
        max: { x: -49, y: 117, z: -15 },
      },
      assumptions: [],
      passes: [
        {
          name: "tower",
          goal: "Build base tower.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: -51, y: 113, z: -17 },
              to: { x: -49, y: 117, z: -15 },
              block: "minecraft:white_wool",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    const plan = buildHeuristicPlan(request, previousPlan);

    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes).toHaveLength(1);
    expect(plan?.passes[0]?.primitives[0]).toEqual({
      type: "fill_cuboid",
      from: { x: -51, y: 118, z: -17 },
      to: { x: -49, y: 119, z: -15 },
      block: "minecraft:white_wool",
    });
  });

  it("extends the previously executed non-tower structure footprint when available", () => {
    const request = {
      ...baseRequest,
      message: "make it taller by 2",
      recentMessages: [],
    };
    const previousPlan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -54, y: 114, z: -20 },
        max: { x: -48, y: 120, z: -14 },
      },
      assumptions: [],
      passes: [
        {
          name: "walls",
          goal: "Build walls.",
          primitives: [
            {
              type: "hollow_cuboid",
              from: { x: -54, y: 115, z: -20 },
              to: { x: -48, y: 118, z: -14 },
              block: "minecraft:oak_planks",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    const plan = buildHeuristicPlan(request, previousPlan);

    expect(plan?.intent).toBe("build_house");
    expect(plan?.passes[0]?.primitives[0]).toEqual({
      type: "fill_cuboid",
      from: { x: -54, y: 121, z: -20 },
      to: { x: -48, y: 122, z: -14 },
      block: "minecraft:oak_planks",
    });
    expect(plan?.targetRegion).toEqual({
      world: "world",
      min: { x: -54, y: 114, z: -20 },
      max: { x: -48, y: 122, z: -14 },
    });
  });
});
