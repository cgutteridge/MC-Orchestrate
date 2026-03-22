import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { WorldReader } from "../world/worldReader.js";
import { runDesignLoop } from "./aiPlanner.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

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

/** A WorldReader that always returns undefined (no disk access in tests). */
const fakeWorldReader: WorldReader = {
  readLevelMetadata: async () => undefined,
  readPlayerMetadata: async () => undefined,
  listRegionFiles: async () => [],
  readRegionBlocks: async () => undefined,
} as unknown as WorldReader;

/**
 * Returns a provider that always returns the given build step JSON.
 */
function buildProvider(json: string): ChatProvider {
  return {
    name: "test",
    async chat() {
      return json;
    },
  };
}

/**
 * Wraps a bare Plan JSON object in the `build` DesignStep wrapper so the loop
 * parses it correctly.
 */
function buildStep(plan: Record<string, unknown>): string {
  return JSON.stringify({ action: "build", plan });
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("runDesignLoop", () => {
  it("returns a plan on the first turn when the AI returns a valid build step", async () => {
    // arrange
    const provider = buildProvider(
      buildStep({
        intent: "build_cylinder",
        targetWorld: "world",
        targetRegion: {
          world: "world",
          min: { x: -53, y: 113, z: -19 },
          max: { x: -49, y: 118, z: -15 },
        },
        assumptions: [],
        passes: [
          {
            name: "cylinder_pass",
            goal: "Build a hollow glass cylinder at the target block.",
            primitives: [
              {
                type: "cylinder",
                center: { x: -51, y: 114, z: -17 },
                radius: 3,
                height: 5,
                block: "minecraft:glass",
                hollow: true,
                axis: "y",
              },
            ],
          },
        ],
        reply: "Here is your hollow glass cylinder!",
        needsMoreInfo: false,
      }),
    );

    // act
    const result = await runDesignLoop(provider, request, fakeWorldReader, undefined);

    // assert
    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.passes).toHaveLength(1);
    expect(result.plan.passes[0]?.primitives[0]).toMatchObject({
      type: "cylinder",
      block: "minecraft:glass",
      hollow: true,
      radius: 3,
      height: 5,
    });
  });

  it("repairs underspecified primitive output and returns a plan", async () => {
    // arrange — the AI sends a cylinder with no center/radius/height
    const provider = buildProvider(
      buildStep({
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
      }),
    );

    // act
    const result = await runDesignLoop(provider, request, fakeWorldReader, undefined);

    // assert
    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.passes[0]?.primitives[0]).toMatchObject({
      type: "cylinder",
      block: "minecraft:glass",
      hollow: true,
      axis: "y",
    });
  });

  it("falls back to unknown when the model omits intent", async () => {
    // arrange
    const provider = buildProvider(
      buildStep({
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
      }),
    );

    // act
    const result = await runDesignLoop(
      provider,
      { ...request, message: "make me a tower here" },
      fakeWorldReader,
      undefined,
    );

    // assert
    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("unknown");
    expect(result.plan.passes).toHaveLength(1);
  });

  it("drops under-specified cuboid primitives and returns needs_more_info when nothing is left", async () => {
    // arrange — both primitives are missing their from/to fields
    const provider = buildProvider(
      buildStep({
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
      }),
    );

    // act
    const result = await runDesignLoop(
      provider,
      { ...request, message: "make me a cottage here" },
      fakeWorldReader,
      undefined,
    );

    // assert — all primitives dropped → needsMoreInfo from repair
    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.needsMoreInfo).toBe(true);
    expect(result.plan.passes).toEqual([]);
  });

  it("drops a partially-specified cylinder when the player did not ask for one", async () => {
    const provider = buildProvider(
      buildStep({
        intent: "unknown",
        passes: [
          {
            name: "mystery",
            goal: "Build something.",
            primitives: [{ type: "cylinder", radius: 3 }],
          },
        ],
        reply: "Building something.",
        needsMoreInfo: false,
      }),
    );

    const result = await runDesignLoop(
      provider,
      { ...request, message: "make me a cottage here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.passes).toEqual([]);
  });

  it("drops unknown primitive types", async () => {
    const provider = buildProvider(
      buildStep({
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
      }),
    );

    const result = await runDesignLoop(
      provider,
      { ...request, message: "make me a cottage here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.passes).toEqual([]);
  });

  it("normalizes clarification-only plans to needsMoreInfo when no executable passes remain", async () => {
    const provider = buildProvider(
      buildStep({
        intent: "unknown",
        passes: [],
        reply: "I can help with that.",
        needsMoreInfo: false,
        clarification: "What size cottage do you want?",
      }),
    );

    const result = await runDesignLoop(
      provider,
      { ...request, message: "make me a cottage here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.needsMoreInfo).toBe(true);
    expect(result.plan.clarification).toBe("What size cottage do you want?");
  });

  it("repairs cuboid primitives that use nested parameters.min/max", async () => {
    const provider = buildProvider(
      buildStep({
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
      }),
    );

    const result = await runDesignLoop(
      provider,
      { ...request, message: "make me a house with a pool here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.passes).toHaveLength(1);
    expect(result.plan.passes[0]?.primitives[0]).toEqual({
      type: "hollow_cuboid",
      from: { x: -127, y: 96, z: -8 },
      to: { x: -124, y: 98, z: -4 },
      block: "minecraft:water",
    });
  });

  it("normalizes generic wool block ids from AI output", async () => {
    const provider = buildProvider(
      buildStep({
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
      }),
    );

    const result = await runDesignLoop(
      provider,
      { ...request, message: "a tower made of wool" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.passes[0]?.primitives[0]).toEqual({
      type: "fill_cuboid",
      from: { x: 1, y: 2, z: 3 },
      to: { x: 2, y: 3, z: 4 },
      block: "minecraft:white_wool",
    });
  });

  it("forces clarification when plan action mismatches the player request", async () => {
    const provider = buildProvider(
      buildStep({
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
      }),
    );

    const result = await runDesignLoop(
      provider,
      { ...request, message: "delete this tree" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.needsMoreInfo).toBe(true);
    expect(result.plan.passes).toEqual([]);
    expect(result.plan.clarification).toContain("clearer action");
  });

  // ---------------------------------------------------------------------------
  // Max turns guard
  // ---------------------------------------------------------------------------

  it("returns needs_more_info when the loop budget is exhausted", async () => {
    // arrange — provider never returns valid JSON
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return "not json at all";
      },
    };

    // act
    const result = await runDesignLoop(provider, request, fakeWorldReader, undefined);

    // assert
    expect(result.outcome).toBe("needs_more_info");
  });

  it("aborts after two consecutive parse failures", async () => {
    let callCount = 0;
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        callCount++;
        // First call: valid plan so the loop doesn't abort immediately.
        // Subsequent calls: bad JSON to trigger consecutive parse failures.
        if (callCount === 1) {
          return buildStep({
            intent: "unknown",
            passes: [
              {
                name: "p",
                goal: "g",
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
            reply: "done",
            needsMoreInfo: false,
          });
        }
        return "not json";
      },
    };

    // First call succeeds and returns a plan.
    const first = await runDesignLoop(provider, request, fakeWorldReader, undefined);
    expect(first.outcome).toBe("plan");

    // Reset and have two consecutive failures → needs_more_info.
    callCount = 0;
    const alwaysBad: ChatProvider = {
      name: "test",
      async chat() {
        callCount++;
        // Return a view_request on turn 1 so the loop continues, then bad.
        if (callCount === 1) {
          return JSON.stringify({
            action: "view_request",
            region: {
              world: "world",
              min: { x: 0, y: 60, z: 0 },
              max: { x: 10, y: 70, z: 10 },
            },
            selfNotes: "I need more context.",
          });
        }
        return "not json";
      },
    };

    const result = await runDesignLoop(alwaysBad, request, fakeWorldReader, undefined);
    expect(result.outcome).toBe("needs_more_info");
  });

  // ---------------------------------------------------------------------------
  // View request fulfillment
  // ---------------------------------------------------------------------------

  it("fulfils a view_request with the initial plugin payload and continues to a plan", async () => {
    // arrange
    const requestWithScan: ChatCommandRequest = {
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [
          { x: -51, y: 112, z: -17, type: "minecraft:stone" },
          { x: -52, y: 112, z: -17, type: "minecraft:oak_log" },
        ],
      },
      initialScanRegion: {
        minX: -58,
        minY: 110,
        minZ: -24,
        maxX: -44,
        maxY: 118,
        maxZ: -12,
      },
    };

    let turn = 0;
    const provider: ChatProvider = {
      name: "test",
      async chat(messages) {
        turn++;
        if (turn === 1) {
          // First turn: request a view within the initial scan bounds.
          return JSON.stringify({
            action: "view_request",
            region: {
              world: "world",
              min: { x: -58, y: 110, z: -24 },
              max: { x: -44, y: 118, z: -12 },
            },
            selfNotes: "Checking what materials are nearby before deciding.",
          });
        }
        // Second turn: verify the scan result is in the user message.
        const lastUser = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
        if (!lastUser.includes("minecraft:stone")) {
          throw new Error("Expected stone block in view fulfillment");
        }
        return buildStep({
          intent: "build_tower",
          targetWorld: "world",
          targetRegion: {
            world: "world",
            min: { x: -52, y: 113, z: -19 },
            max: { x: -50, y: 120, z: -17 },
          },
          assumptions: [],
          passes: [
            {
              name: "tower",
              goal: "Build a stone tower.",
              primitives: [
                {
                  type: "fill_cuboid",
                  from: { x: -52, y: 113, z: -19 },
                  to: { x: -50, y: 120, z: -17 },
                  block: "minecraft:stone",
                },
              ],
            },
          ],
          reply: "Built a stone tower.",
          needsMoreInfo: false,
        });
      },
    };

    // act
    const result = await runDesignLoop(provider, requestWithScan, fakeWorldReader, undefined);

    // assert
    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("build_tower");
    expect(turn).toBe(2);
  });

  it("accepts a bare Plan JSON (without action wrapper) by falling back to Plan parsing", async () => {
    // Some AI models may return a Plan directly. The loop should handle this.
    const provider = buildProvider(
      JSON.stringify({
        intent: "build_house",
        targetWorld: "world",
        targetRegion: {
          world: "world",
          min: { x: -51, y: 113, z: -19 },
          max: { x: -47, y: 120, z: -15 },
        },
        assumptions: [],
        passes: [
          {
            name: "walls",
            goal: "Build walls.",
            primitives: [
              {
                type: "hollow_cuboid",
                from: { x: -51, y: 113, z: -19 },
                to: { x: -47, y: 120, z: -15 },
                block: "minecraft:stone",
              },
            ],
          },
        ],
        reply: "Here is your house.",
        needsMoreInfo: false,
      }),
    );

    const result = await runDesignLoop(provider, request, fakeWorldReader, undefined);

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("build_house");
  });
});
