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
  localContext: {
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
      center: { x: -51, y: 113, z: -17 },
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
              primitives: [{ type: "fill_cuboid" }],
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
});
