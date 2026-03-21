import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import { buildAiPlan } from "./aiPlanner.js";

const request: ChatCommandRequest = {
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
  message: "make me a hollow glass cylinder here",
  recentMessages: [],
  localContext: {
    targetBlock: {
      x: -51,
      y: 113,
      z: -17,
      type: "minecraft:grass_block",
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

describe("buildAiPlan", () => {
  it("repairs underspecified primitive output into a valid plan", async () => {
    // arrange
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "unknown",
          passes: [
            {
              name: "Create Hollow Glass Cylinder",
              goal: "Build a hollow glass cylinder at the player's position.",
              primitives: [{ type: "cylinder" }],
            },
          ],
          reply: "I'll create a hollow glass cylinder for you!",
          needsMoreInfo: false,
        });
      },
    };

    // act
    const plan = await buildAiPlan(provider, request);

    // assert
    expect(plan.targetWorld).toBe("world");
    expect(plan.targetRegion.world).toBe("world");
    expect(plan.passes).toHaveLength(1);
    expect(plan.passes[0]?.primitives[0]).toMatchObject({
      type: "cylinder",
      block: "minecraft:glass",
      hollow: true,
      axis: "y",
      radius: 2,
      height: 5,
      center: { x: -51, y: 114, z: -17 },
    });
  });

  it("falls back to unknown when the model omits intent", async () => {
    // arrange
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          passes: [
            {
              name: "Create tower",
              goal: "Build a tower.",
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: -51, y: 113, z: -17 },
                  to: { x: -51, y: 117, z: -17 },
                  block: "minecraft:stone",
                },
              ],
            },
          ],
          reply: "Building it.",
          needsMoreInfo: false,
        });
      },
    };

    // act
    const plan = await buildAiPlan(provider, {
      ...request,
      message: "make me a tower here",
    });

    // assert
    expect(plan.intent).toBe("unknown");
    expect(plan.passes).toHaveLength(1);
  });

  it("drops under-specified cuboid primitives instead of fabricating a default blob", async () => {
    // arrange
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "unknown",
          passes: [
            {
              name: "Build cottage",
              goal: "Build a cottage shell.",
              primitives: [{ type: "fill_cuboid" }, { type: "hollow_cuboid" }],
            },
          ],
          reply: "Your cottage is being built!",
          needsMoreInfo: false,
        });
      },
    };

    // act
    const plan = await buildAiPlan(provider, {
      ...request,
      message: "make me a cottage here",
    });

    // assert
    expect(plan.passes).toEqual([]);
  });

  it("drops under-specified cylinders unless the player explicitly asked for one", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "unknown",
          passes: [
            {
              name: "mystery",
              goal: "Build something.",
              primitives: [{ type: "cylinder" }],
            },
          ],
          reply: "Building something.",
          needsMoreInfo: false,
        });
      },
    };

    const plan = await buildAiPlan(provider, {
      ...request,
      message: "make me a cottage here",
    });

    expect(plan.passes).toEqual([]);
  });

  it("drops unknown primitive types instead of fabricating a set_block action", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "unknown",
          passes: [
            {
              name: "mystery",
              goal: "Do something.",
              primitives: [{ type: "build_magic_house", foo: "bar" }],
            },
          ],
          reply: "Building something strange.",
          needsMoreInfo: false,
        });
      },
    };

    const plan = await buildAiPlan(provider, {
      ...request,
      message: "make me a cottage here",
    });

    expect(plan.passes).toEqual([]);
  });

  it("normalizes clarification-only plans to needsMoreInfo when no executable passes remain", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "unknown",
          passes: [],
          reply: "I can help with that.",
          needsMoreInfo: false,
          clarification: "What size cottage do you want?",
        });
      },
    };

    const plan = await buildAiPlan(provider, {
      ...request,
      message: "make me a cottage here",
    });

    expect(plan.needsMoreInfo).toBe(true);
    expect(plan.clarification).toBe("What size cottage do you want?");
    expect(plan.passes).toEqual([]);
  });

  it("repairs cuboid primitives that still use nested parameters.min/max", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "build_house",
          passes: [
            {
              name: "create_pool",
              goal: "Build a swimming pool.",
              primitives: [
                {
                  type: "hollow_cuboid",
                  parameters: {
                    min: { x: -127, y: 96, z: -8 },
                    max: { x: -124, y: 98, z: -4 },
                    block: "minecraft:water",
                  },
                },
              ],
            },
          ],
          reply: "Swimming pool will be built in the specified area.",
          needsMoreInfo: false,
        });
      },
    };

    const plan = await buildAiPlan(provider, {
      ...request,
      message: "make me a house with a pool here",
    });

    expect(plan.passes).toHaveLength(1);
    expect(plan.passes[0]?.primitives[0]).toEqual({
      type: "hollow_cuboid",
      from: { x: -127, y: 96, z: -8 },
      to: { x: -124, y: 98, z: -4 },
      block: "minecraft:water",
    });
  });

  it("normalizes generic wool block ids from AI output", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "build_tower",
          passes: [
            {
              name: "body",
              goal: "Build a wool shape.",
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: 1, y: 2, z: 3 },
                  to: { x: 2, y: 3, z: 4 },
                  block: "minecraft:wool",
                },
              ],
            },
          ],
          reply: "Building it.",
          needsMoreInfo: false,
        });
      },
    };

    const plan = await buildAiPlan(provider, {
      ...request,
      message: "a tower made of wool",
    });

    expect(plan.passes[0]?.primitives[0]).toEqual({
      type: "fill_cuboid",
      from: { x: 1, y: 2, z: 3 },
      to: { x: 2, y: 3, z: 4 },
      block: "minecraft:white_wool",
    });
  });

  it("forces clarification when intent does not match the player request", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return JSON.stringify({
          intent: "build_house",
          passes: [
            {
              name: "shell",
              goal: "Build something.",
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: 0, y: 64, z: 0 },
                  to: { x: 1, y: 65, z: 1 },
                  block: "minecraft:stone",
                },
              ],
            },
          ],
          reply: "Building it.",
          needsMoreInfo: false,
        });
      },
    };

    const plan = await buildAiPlan(provider, {
      ...request,
      message: "write me a poem",
    });

    expect(plan.needsMoreInfo).toBe(true);
    expect(plan.passes).toEqual([]);
    expect(plan.clarification).toContain("build a house");
  });
});
