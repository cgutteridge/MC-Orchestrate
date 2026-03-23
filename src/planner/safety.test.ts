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
  recentMessages: [],
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
    };

    // act
    const result = validatePlanSafety(request, plan);

    // assert
    expect(result).toContain("standing in");
  });

  it("rejects regions wider than 32 blocks", () => {
    const plan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 40, y: 110, z: 40 }, // 41 wide × 47 tall × 41 deep — over width limit
      },
      assumptions: [],
      passes: [],
      reply: "nope",
    };

    const result = validatePlanSafety(request, plan);

    expect(result).toBeTruthy();
  });

  it("rejects a layer map whose estimated block count exceeds the per-request limit", () => {
    const row = "S".repeat(21);
    const layer = Array.from({ length: 21 }, () => row).join("\n");
    const layers = Array.from({ length: 21 }, () => layer);
    const plan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 4, y: 68, z: 4 },
      },
      assumptions: [],
      passes: [
        {
          name: "column",
          goal: "Oversized solid layer map.",
          primitives: [],
          layerMap: {
            layers,
            palette: { S: "minecraft:stone", _: "minecraft:air" },
          },
        },
      ],
      reply: "Building it.",
    };

    const result = validatePlanSafety(request, plan);

    expect(result).toContain("8192");
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
    };

    // act
    const result = validatePlanSafety(request, plan);

    // assert
    expect(result).toBeUndefined();
  });
});
