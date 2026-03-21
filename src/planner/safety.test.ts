import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { validatePlanSafety } from "./safety.js";
import type { Plan } from "./schema.js";

const request: ChatCommandRequest = {
  requestId: "req-1",
  player: {
    uuid: "u1",
    name: "cjg",
    world: "world",
    position: { x: 0, y: 64, z: 0 },
    yaw: 0,
    pitch: 0,
    lookVector: { x: 1, y: 0, z: 0 },
  },
  message: "make me a tower here",
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

describe("validatePlanSafety", () => {
  it("rejects cross-world plans", () => {
    // arrange
    const plan: Plan = {
      intent: "build_tower",
      targetWorld: "world_nether",
      targetRegion: {
        world: "world_nether",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 0, y: 68, z: 0 },
      },
      assumptions: [],
      passes: [],
      reply: "nope",
      needsMoreInfo: false,
    };

    // act
    const result = validatePlanSafety(request, plan);

    // assert
    expect(result).toContain("current world");
  });

  it("rejects oversized regions", () => {
    // arrange
    const plan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 20, y: 100, z: 20 },
      },
      assumptions: [],
      passes: [],
      reply: "nope",
      needsMoreInfo: false,
    };

    // act
    const result = validatePlanSafety(request, plan);

    // assert
    expect(result).toBeTruthy();
  });

  it("normalizes reversed target regions before checking size and distance", () => {
    // arrange
    const plan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 5, y: 68, z: 5 },
        max: { x: 0, y: 64, z: 0 },
      },
      assumptions: [],
      passes: [],
      reply: "ok",
      needsMoreInfo: false,
    };

    // act
    const result = validatePlanSafety(request, plan);

    // assert
    expect(result).toBeUndefined();
  });
});
