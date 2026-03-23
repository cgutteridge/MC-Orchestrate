import { describe, expect, it } from "vitest";
import type { ChatProvider } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { WorldReader } from "../world/worldReader.js";
import { runPlacementThenBuild } from "./aiPlanner.js";
import { sanitizePlanMaterials } from "./materialResolver.js";

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

/** A WorldReader that always reports disk scan unavailable (no disk access in tests). */
const fakeWorldReader: WorldReader = {
  readLevelMetadata: async () => undefined,
  readPlayerMetadata: async () => undefined,
  listRegionFiles: async () => [],
  readRegionBlocks: async () => undefined,
  readRegionBlocksOutcome: async () => ({
    ok: false,
    reason: "World region directory is missing or not readable.",
  }),
} as unknown as WorldReader;

/** 5×5 footprint × 6 Y layers — hollow glass ring (fits default cylinder target box). */
const LAYER_RING_GLASS = {
  layers: Array.from({ length: 6 }, () => "GGGGG\nG___G\nG___G\nG___G\nGGGGG"),
  palette: { G: "minecraft:glass", _: "minecraft:air" },
};

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

/** Step 1 JSON — valid {@link PlacementChoiceStepSchema} for tests. */
function placementChoiceJson(placement: Record<string, unknown>): string {
  return JSON.stringify({
    action: "placement_choice",
    placement,
  });
}

/** Provider: turn 1 = placement_choice, turn 2+ = build with plan. */
function twoTurnProvider(plan: Record<string, unknown>): ChatProvider {
  let turn = 0;
  return {
    name: "test",
    async chat() {
      turn++;
      if (turn === 1) {
        return placementChoiceJson({
          ref: "focus",
          forward: 0,
          back: 0,
          left: 0,
          right: 0,
          north: 0,
          south: 0,
          east: 0,
          west: 0,
          up: 0,
          down: 0,
          desiredSize: { width: 5, depth: 5, height: 6 },
          verticalReference: "middle",
        });
      }
      return buildStep(plan);
    },
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("runPlacementThenBuild", () => {
  it("returns a plan after placement_choice then build (merged placement)", async () => {
    const provider = twoTurnProvider({
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
          primitives: [],
          layerMap: LAYER_RING_GLASS,
        },
      ],
      reply: "Here is your hollow glass cylinder!",
    });

    const result = await runPlacementThenBuild(provider, request, fakeWorldReader, undefined);

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.placement.ref).toBe("focus");
    expect(result.plan.passes).toHaveLength(1);
    expect(result.plan.passes[0]?.layerMap.palette.G).toBe("minecraft:glass");
  });

  it("includes prior chat lines in the initial user message for follow-up resolution", async () => {
    const followUpRequest: ChatCommandRequest = {
      ...request,
      message: "make it taller",
      recentMessages: ["build a small stone tower here"],
    };

    const layer3x3 = "SSS\nSSS\nSSS";
    let turn = 0;
    const provider: ChatProvider = {
      name: "test",
      async chat(messages) {
        turn++;
        if (turn === 1) {
          return placementChoiceJson({
            ref: "player_view",
            forward: 0,
            back: 0,
            left: 0,
            right: 0,
            north: 0,
            south: 0,
            east: 0,
            west: 0,
            up: 0,
            down: 0,
            desiredSize: { width: 8, depth: 8, height: 16 },
            verticalReference: "bottom",
          });
        }
        const user = messages.find((m) => m.role === "user")?.content ?? "";
        if (!user.includes("Earlier lines:")) {
          throw new Error("Expected earlier-lines follow-up context in plan-phase user message");
        }
        if (!user.includes("build a small stone tower here")) {
          throw new Error("Expected prior message in prompt");
        }
        if (!user.includes("Build request: make it taller")) {
          throw new Error("Expected current message in plan-phase user content");
        }
        return buildStep({
          intent: "build_tower",
          targetWorld: "world",
          targetRegion: {
            world: "world",
            min: { x: -52, y: 113, z: -19 },
            max: { x: -50, y: 125, z: -17 },
          },
          assumptions: [],
          passes: [
            {
              name: "tower",
              goal: "Extend the stone tower upward per the player's follow-up request.",
              primitives: [],
              layerMap: {
                layers: Array.from({ length: 13 }, () => layer3x3),
                palette: { S: "minecraft:stone", _: "minecraft:air" },
              },
            },
          ],
          reply: "Made it taller.",
        });
      },
    };

    const result = await runPlacementThenBuild(
      provider,
      followUpRequest,
      fakeWorldReader,
      undefined,
    );
    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("build_tower");
    expect(result.plan.passes[0]?.goal).toContain("follow-up");
  });

  it("repairs loose layer map objects before validation", async () => {
    const provider = twoTurnProvider({
      intent: "unknown",
      passes: [
        {
          name: "Create Hollow Glass Cylinder",
          goal: "Build a hollow glass cylinder at the player's position.",
          primitives: [],
          layerMap: {
            layers: LAYER_RING_GLASS.layers,
            palette: { G: "minecraft:glass", _: "minecraft:air" },
          },
        },
      ],
      reply: "I'll create a hollow glass cylinder for you!",
    });

    const result = await runPlacementThenBuild(provider, request, fakeWorldReader, undefined);

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.passes[0]?.layerMap.layers.length).toBe(6);
  });

  it("falls back to unknown when the model omits intent", async () => {
    const provider = twoTurnProvider({
      passes: [
        {
          name: "Create tower",
          goal: "Build a tower.",
          primitives: [],
          layerMap: {
            layers: ["S"],
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
      ],
      reply: "Building it.",
    });

    const result = await runPlacementThenBuild(
      provider,
      { ...request, message: "make me a tower here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("unknown");
    expect(result.plan.passes).toHaveLength(1);
  });

  it("rejects after max steps when assistant keeps returning build in placement phase", async () => {
    const provider = buildProvider(
      buildStep({
        intent: "unknown",
        passes: [
          {
            name: "mystery",
            goal: "Build something.",
            primitives: [],
            layerMap: {
              layers: ["S"],
              palette: { S: "minecraft:stone", _: "minecraft:air" },
            },
          },
        ],
        reply: "Building something.",
      }),
    );

    const result = await runPlacementThenBuild(
      provider,
      { ...request, message: "make me a cottage here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") {
      return;
    }
    expect(result.reason).toContain("ran out of planning steps");
  });

  it("rejects after max steps when passes have no layer map (repair drops them)", async () => {
    const provider = twoTurnProvider({
      intent: "unknown",
      passes: [
        {
          name: "mystery",
          goal: "Do something.",
          primitives: [],
        },
      ],
      reply: "Building something strange.",
    });

    const result = await runPlacementThenBuild(
      provider,
      { ...request, message: "make me a cottage here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") {
      return;
    }
    expect(result.reason).toContain("ran out of planning steps");
  });

  it("rejects clarification-only plans with no executable passes", async () => {
    const provider = twoTurnProvider({
      intent: "unknown",
      passes: [],
      reply: "I can help with that.",
    });

    const result = await runPlacementThenBuild(
      provider,
      { ...request, message: "make me a cottage here" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") {
      return;
    }
    expect(result.reason).toContain("ran out of planning steps");
  });

  it("normalizes generic wool block ids in layer map palettes at execution sanitize", async () => {
    const provider = twoTurnProvider({
      intent: "build_tower",
      passes: [
        {
          name: "body",
          goal: "Build a wool shape.",
          primitives: [],
          layerMap: {
            layers: ["W"],
            palette: { W: "minecraft:wool", _: "minecraft:air" },
          },
        },
      ],
      reply: "Building it.",
    });

    const result = await runPlacementThenBuild(
      provider,
      { ...request, message: "a tower made of wool" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    const sanitized = sanitizePlanMaterials(result.plan);
    expect(sanitized.plan.passes[0]?.layerMap.palette.W).toBe("minecraft:white_wool");
  });

  it("rejects when plan action mismatches the player request (repair drops passes)", async () => {
    const provider = twoTurnProvider({
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 1, y: 65, z: 1 },
      },
      assumptions: [],
      passes: [
        {
          name: "shell",
          goal: "Build something.",
          primitives: [],
          layerMap: {
            layers: ["SS", "SS"],
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
      ],
      reply: "Building it.",
    });

    const result = await runPlacementThenBuild(
      provider,
      { ...request, message: "delete this tree" },
      fakeWorldReader,
      undefined,
    );

    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected") {
      return;
    }
    expect(result.reason).toContain("ran out of planning steps");
  });

  // ---------------------------------------------------------------------------
  // Max turns guard
  // ---------------------------------------------------------------------------

  it("rejects after two consecutive replies without usable JSON", async () => {
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        return "not json at all";
      },
    };

    const result = await runPlacementThenBuild(provider, request, fakeWorldReader, undefined);

    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toContain("couldn't lock in a valid build plan");
    }
  });

  it("aborts after two consecutive parse failures", async () => {
    let callCount = 0;
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        callCount++;
        if (callCount === 1) {
          return placementChoiceJson({
            ref: "player_view",
            forward: 0,
            back: 0,
            left: 0,
            right: 0,
            north: 0,
            south: 0,
            east: 0,
            west: 0,
            up: 0,
            down: 0,
            desiredSize: { width: 8, depth: 8, height: 8 },
            verticalReference: "middle",
          });
        }
        if (callCount === 2) {
          return buildStep({
            intent: "unknown",
            passes: [
              {
                name: "p",
                goal: "g",
                primitives: [],
                layerMap: {
                  layers: ["S"],
                  palette: { S: "minecraft:stone", _: "minecraft:air" },
                },
              },
            ],
            reply: "done",
          });
        }
        return "not json";
      },
    };

    const first = await runPlacementThenBuild(provider, request, fakeWorldReader, undefined);
    expect(first.outcome).toBe("plan");

    callCount = 0;
    const alwaysBad: ChatProvider = {
      name: "test",
      async chat() {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            action: "placement_choice",
            placement: {
              ref: "player_view",
              forward: 0,
              desiredSize: { width: 8, depth: 8, height: 6 },
              verticalReference: "middle",
            },
          });
        }
        return "not json";
      },
    };

    const result = await runPlacementThenBuild(alwaysBad, request, fakeWorldReader, undefined);
    expect(result.outcome).toBe("rejected");
    if (result.outcome === "rejected") {
      expect(result.reason).toContain("couldn't lock in a valid build plan");
    }
  });

  it("accepts a bare Plan JSON (without action wrapper) by falling back to Plan parsing", async () => {
    let turn = 0;
    const provider: ChatProvider = {
      name: "test",
      async chat() {
        turn++;
        if (turn === 1) {
          return placementChoiceJson({
            ref: "player_view",
            forward: 8,
            back: 0,
            left: 0,
            right: 0,
            north: 0,
            south: 0,
            east: 0,
            west: 0,
            up: 0,
            down: 0,
            desiredSize: { width: 16, depth: 16, height: 12 },
            verticalReference: "middle",
          });
        }
        const layer = "SSSSS\nSSSSS\nSSSSS\nSSSSS\nSSSSS";
        return JSON.stringify({
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
              primitives: [],
              layerMap: {
                layers: Array.from({ length: 8 }, () => layer),
                palette: { S: "minecraft:stone", _: "minecraft:air" },
              },
            },
          ],
          reply: "Here is your house.",
        });
      },
    };

    const result = await runPlacementThenBuild(provider, request, fakeWorldReader, undefined);

    expect(result.outcome).toBe("plan");
    if (result.outcome !== "plan") {
      return;
    }
    expect(result.plan.intent).toBe("build_house");
  });
});
