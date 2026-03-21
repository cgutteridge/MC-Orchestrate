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
  it("returns undefined for direct requests so AI can handle broader intents", () => {
    const tower = buildHeuristicPlan({
      ...baseRequest,
      message: "make me a 5 block stone tower here",
    });
    const house = buildHeuristicPlan({
      ...baseRequest,
      message: "make me a house here",
    });
    const tree = buildHeuristicPlan({
      ...baseRequest,
      message: "delete this tree",
    });

    expect(tower).toBeUndefined();
    expect(house).toBeUndefined();
    expect(tree).toBeUndefined();
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

  it("clamps height delta to 8 when the player asks for more than 8 blocks taller", () => {
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
    // Delta is capped at 8
    expect(plan?.passes[0]?.primitives[0]).toMatchObject({
      from: { y: 71 },
      to: { y: 78 },
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
