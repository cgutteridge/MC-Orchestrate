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
});
