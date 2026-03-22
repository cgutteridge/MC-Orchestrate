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

describe("buildHeuristicPlan — template dispatch", () => {
  it("compiles a simple tower request deterministically", () => {
    const request = {
      ...baseRequest,
      message: "make me a stone tower here",
    };

    const a = buildHeuristicPlan(request);
    const b = buildHeuristicPlan(request);

    expect(a?.intent).toBe("build_tower");
    expect(a?.needsMoreInfo).toBe(false);
    expect(a?.passes).toHaveLength(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("compiles a hollow tower when 'hollow' is in the message", () => {
    const plan = buildHeuristicPlan({
      ...baseRequest,
      message: "build a hollow tower here",
    });

    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      type: "hollow_cuboid",
    });
  });

  it("compiles a cottage request deterministically", () => {
    const request = {
      ...baseRequest,
      message: "build me a house here",
    };

    const a = buildHeuristicPlan(request);
    const b = buildHeuristicPlan(request);

    expect(a?.intent).toBe("build_cottage");
    expect(a?.needsMoreInfo).toBe(false);
    expect(a?.passes).toHaveLength(2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("compiles a bridge request and orients it along the player look direction", () => {
    const request = {
      ...baseRequest,
      message: "build me a bridge here",
      player: {
        ...baseRequest.player,
        lookVector: { x: 1, y: 0, z: 0 }, // looking in +X
      },
    };

    const a = buildHeuristicPlan(request);
    const b = buildHeuristicPlan(request);

    expect(a?.intent).toBe("build_bridge");
    expect(a?.needsMoreInfo).toBe(false);
    // Bridge spans along X with railings → 3 passes
    expect(a?.passes).toHaveLength(3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("returns undefined for complex template variations so AI handles them", () => {
    const spiral = buildHeuristicPlan({
      ...baseRequest,
      message: "build me a spiral tower here",
    });
    const lighthouse = buildHeuristicPlan({
      ...baseRequest,
      message: "build me a lighthouse",
    });

    expect(spiral).toBeUndefined();
    expect(lighthouse).toBeUndefined();
  });

  it("material follow-up with a previousPlan does not accidentally trigger a template compiler", () => {
    // "use stone instead" contains no template keyword, so templates don't match;
    // follow-up context applies the material restyle to the prior plan.
    const previousPlan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -1, y: 64, z: -1 },
        max: { x: 1, y: 71, z: 1 },
      },
      assumptions: [],
      passes: [
        {
          name: "tower_column",
          goal: "Build tower.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: -1, y: 64, z: -1 },
              to: { x: 1, y: 71, z: 1 },
              block: "minecraft:stone",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    // "use stone instead" — with previous plan, should restyle, not build new
    const plan = buildHeuristicPlan(
      { ...baseRequest, message: "use stone instead" },
      previousPlan,
    );

    // Should be a material restyle applied to the previous structure's region.
    expect(plan?.intent).toBe("build_tower");
    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      block: "minecraft:stone",
    });
    expect(plan?.targetRegion).toEqual(previousPlan.targetRegion);
  });
});

describe("buildHeuristicPlan", () => {
  it("compiles a barn request with gabled roof", () => {
    const plan = buildHeuristicPlan({
      ...baseRequest,
      message: "build me a barn here",
    });

    expect(plan?.intent).toBe("build_barn");
    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes).toHaveLength(2);
    expect(plan?.passes[1]?.name).toBe("gabled_roof");
  });

  it("compiles a gazebo request with platform, posts and roof", () => {
    const plan = buildHeuristicPlan({
      ...baseRequest,
      message: "build me a gazebo here",
    });

    expect(plan?.intent).toBe("build_gazebo");
    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes).toHaveLength(3);
    expect(plan?.passes[0]?.name).toBe("platform");
    expect(plan?.passes[2]?.name).toBe("roof_cap");
  });

  it("returns undefined for requests outside the heuristic scope so the AI handles them", () => {
    // Removal commands are not handled heuristically (no structure template).
    const tree = buildHeuristicPlan({
      ...baseRequest,
      message: "delete this tree",
    });
    // Complex variations are explicitly excluded from template compilers.
    const spiral = buildHeuristicPlan({
      ...baseRequest,
      message: "build me a spiral staircase",
    });
    // Requests with no known template trigger fall through to the AI.
    const pyramid = buildHeuristicPlan({
      ...baseRequest,
      message: "build me a pyramid",
    });

    expect(tree).toBeUndefined();
    expect(spiral).toBeUndefined();
    expect(pyramid).toBeUndefined();
  });

  it("asks for clarification when 'taller' has no previous structure context", () => {
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

  it("extends the previous structure footprint for taller follow-ups", () => {
    const request = {
      ...baseRequest,
      message: "make it taller by 2",
      recentMessages: [],
    };
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -51, y: 113, z: -17 },
        max: { x: -49, y: 117, z: -15 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base structure.",
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

    expect(plan?.intent).toBe("build_structure");
    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes).toHaveLength(1);
    expect(plan?.passes[0]?.primitives[0]).toEqual({
      type: "fill_cuboid",
      from: { x: -51, y: 118, z: -17 },
      to: { x: -49, y: 119, z: -15 },
      block: "minecraft:white_wool",
    });
    expect(plan?.targetRegion).toEqual({
      world: "world",
      min: { x: -51, y: 113, z: -17 },
      max: { x: -49, y: 119, z: -15 },
    });
  });

  it("extends the previous structure footprint for 'higher' follow-ups", () => {
    const request = {
      ...baseRequest,
      message: "make it higher by 3",
      recentMessages: [],
    };
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -51, y: 113, z: -17 },
        max: { x: -49, y: 117, z: -15 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base structure.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: -51, y: 113, z: -17 },
              to: { x: -49, y: 117, z: -15 },
              block: "minecraft:stone",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    const plan = buildHeuristicPlan(request, previousPlan);

    expect(plan?.intent).toBe("build_structure");
    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      type: "fill_cuboid",
      from: { x: -51, y: 118, z: -17 },
      to: { x: -49, y: 120, z: -15 },
      block: "minecraft:stone",
    });
  });

  it("clamps height delta to 16 when the player asks for more than 16 blocks taller", () => {
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 4, y: 70, z: 4 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 4, y: 70, z: 4 },
              block: "minecraft:stone",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    const plan = buildHeuristicPlan(
      { ...baseRequest, message: "make it taller by 20" },
      previousPlan,
    );

    expect(plan?.needsMoreInfo).toBe(false);
    // Delta is capped at 16
    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      from: { y: 71 },
      to: { y: 86 },
    });
  });

  it("picks up a bare number in 'taller' messages without a 'by' keyword", () => {
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 2, y: 68, z: 2 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 2, y: 68, z: 2 },
              block: "minecraft:stone",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    const plan = buildHeuristicPlan(
      { ...baseRequest, message: "make it 3 taller" },
      previousPlan,
    );

    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      from: { y: 69 },
      to: { y: 71 },
    });
  });

  it("defaults to 2 when 'taller' has no number in the message", () => {
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 2, y: 68, z: 2 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 2, y: 68, z: 2 },
              block: "minecraft:stone",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    const plan = buildHeuristicPlan(
      { ...baseRequest, message: "make it taller please" },
      previousPlan,
    );

    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      from: { y: 69 },
      to: { y: 70 },
    });
  });

  it("does not treat non-structure plans as height-adjustable follow-up context", () => {
    const request = {
      ...baseRequest,
      message: "make it taller by 2",
    };
    const previousPlan: Plan = {
      intent: "remove_tree",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -51, y: 113, z: -17 },
        max: { x: -49, y: 117, z: -15 },
      },
      assumptions: [],
      passes: [
        {
          name: "cleanup",
          goal: "Remove logs.",
          primitives: [
            {
              type: "replace_in_region",
              from: { x: -51, y: 113, z: -17 },
              to: { x: -49, y: 117, z: -15 },
              fromBlock: "minecraft:oak_log",
              toBlock: "minecraft:air",
            },
          ],
        },
      ],
      reply: "Removed.",
      needsMoreInfo: false,
    };

    const plan = buildHeuristicPlan(request, previousPlan);

    expect(plan?.intent).toBe("unknown");
    expect(plan?.needsMoreInfo).toBe(true);
  });

  it("restyles the previous structure when a follow-up material is requested", () => {
    const request = {
      ...baseRequest,
      message: "use oak instead",
      recentMessages: [],
    };
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -51, y: 113, z: -17 },
        max: { x: -49, y: 117, z: -15 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base structure.",
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

    expect(plan?.intent).toBe("build_structure");
    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.passes[0]?.primitives[0]).toEqual({
      type: "fill_cuboid",
      from: { x: -51, y: 113, z: -17 },
      to: { x: -49, y: 117, z: -15 },
      block: "minecraft:oak_planks",
    });
    expect(plan?.reply).toContain("minecraft:oak_planks");
  });

  it("restyles the previous structure via 'with' and 'as' material phrasing", () => {
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -51, y: 113, z: -17 },
        max: { x: -49, y: 117, z: -15 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base structure.",
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

    const withStone = buildHeuristicPlan(
      { ...baseRequest, message: "rebuild it with stone", recentMessages: [] },
      previousPlan,
    );
    expect(withStone?.needsMoreInfo).toBe(false);
    expect(withStone?.passes[0]?.primitives[0]).toMatchObject({
      block: "minecraft:stone",
    });

    const asGlass = buildHeuristicPlan(
      { ...baseRequest, message: "redo it as glass", recentMessages: [] },
      previousPlan,
    );
    expect(asGlass?.needsMoreInfo).toBe(false);
    expect(asGlass?.passes[0]?.primitives[0]).toMatchObject({
      block: "minecraft:glass",
    });

    const twoWord = buildHeuristicPlan(
      { ...baseRequest, message: "oak planks", recentMessages: [] },
      previousPlan,
    );
    expect(twoWord?.needsMoreInfo).toBe(false);
    expect(twoWord?.passes[0]?.primitives[0]).toMatchObject({
      block: "minecraft:oak_planks",
    });
  });

  it("asks for clarification on material follow-up with no structure context", () => {
    const request = {
      ...baseRequest,
      message: "oak",
      recentMessages: [],
      localContext: {
        ...baseRequest.localContext,
        targetBlock: undefined,
      },
    };

    const plan = buildHeuristicPlan(request);

    expect(plan?.intent).toBe("unknown");
    expect(plan?.needsMoreInfo).toBe(true);
    expect(plan?.reply).toContain("restyle");
    expect(plan?.clarification).toContain("structure context");
  });

  it("returns the structure's coordinates when the player can't find it", () => {
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -60, y: 64, z: -20 },
        max: { x: -56, y: 70, z: -16 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build structure.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: -60, y: 64, z: -20 },
              to: { x: -56, y: 70, z: -16 },
              block: "minecraft:stone",
            },
          ],
        },
      ],
      reply: "Built.",
      needsMoreInfo: false,
    };

    const phrases = [
      "I can't see it",
      "where is it",
      "where did it go",
      "I can't find it",
    ];

    for (const message of phrases) {
      const plan = buildHeuristicPlan({ ...baseRequest, message }, previousPlan);
      expect(plan?.needsMoreInfo, `"${message}" should produce needsMoreInfo`).toBe(true);
      expect(plan?.reply, `"${message}" reply should contain coords`).toContain("-58");
      expect(plan?.clarification, `"${message}" clarification should contain /tp`).toContain("/tp");
    }
  });

  it("returns no-context clarification for location query with no previous structure", () => {
    const plan = buildHeuristicPlan({
      ...baseRequest,
      message: "where is it",
      recentMessages: [],
    });

    expect(plan?.needsMoreInfo).toBe(true);
    expect(plan?.reply).toContain("don't have");
  });

  it("asks for clarification on 'bigger' with no previous structure context", () => {
    const request = {
      ...baseRequest,
      message: "make it bigger by 2",
      recentMessages: [],
    };

    const plan = buildHeuristicPlan(request);

    expect(plan?.intent).toBe("unknown");
    expect(plan?.needsMoreInfo).toBe(true);
    expect(plan?.reply).toContain("bigger");
    expect(plan?.clarification).toContain("structure context");
  });

  it("expands the previous structure footprint for bigger follow-ups", () => {
    const request = {
      ...baseRequest,
      message: "make it bigger by 2",
      recentMessages: [],
    };
    const previousPlan: Plan = {
      intent: "build_structure",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: -51, y: 113, z: -17 },
        max: { x: -49, y: 117, z: -15 },
      },
      assumptions: [],
      passes: [
        {
          name: "base",
          goal: "Build base structure.",
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

    expect(plan?.intent).toBe("build_structure");
    expect(plan?.needsMoreInfo).toBe(false);
    expect(plan?.targetRegion).toEqual({
      world: "world",
      min: { x: -53, y: 113, z: -19 },
      max: { x: -47, y: 117, z: -13 },
    });
    expect(plan?.passes[0]?.primitives).toHaveLength(4);
    expect(plan?.reply).toContain("2 blocks bigger");
  });
});
