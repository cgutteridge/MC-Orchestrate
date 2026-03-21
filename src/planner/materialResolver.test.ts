import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import { resolvePlanMaterials } from "./materialResolver.js";
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
    lookVector: { x: 0, y: 0, z: 1 },
  },
  message: "build a sheep statue from wool",
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

describe("resolvePlanMaterials", () => {
  it("normalizes generic material aliases to valid Minecraft block ids", () => {
    const plan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 1, y: 65, z: 1 },
      },
      assumptions: [],
      passes: [
        {
          name: "body",
          goal: "Build with wool.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 1, y: 65, z: 1 },
              block: "minecraft:wool",
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, request);

    expect(resolved.passes[0]?.primitives[0]).toEqual({
      type: "fill_cuboid",
      from: { x: 0, y: 64, z: 0 },
      to: { x: 1, y: 65, z: 1 },
      block: "minecraft:white_wool",
    });
  });

  it("maps vague wood-like materials to concrete defaults", () => {
    const plan: Plan = {
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
          name: "roof",
          goal: "Build with wood.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 1, y: 65, z: 1 },
              block: "minecraft:wood",
            },
            {
              type: "cylinder",
              center: { x: 0, y: 64, z: 0 },
              radius: 1,
              height: 2,
              block: "fence",
              hollow: false,
              axis: "y",
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, request);

    expect(resolved.passes[0]?.primitives[0]).toMatchObject({
      block: "minecraft:oak_planks",
    });
    expect(resolved.passes[0]?.primitives[1]).toMatchObject({
      block: "minecraft:oak_fence",
    });
  });

  it("converts unresolved materials into clarification instead of executing", () => {
    const plan: Plan = {
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
          goal: "Build with mystery block.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 1, y: 65, z: 1 },
              block: "minecraft:sheep_fluff",
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, request);

    expect(resolved.needsMoreInfo).toBe(true);
    expect(resolved.passes).toEqual([]);
    expect(resolved.clarification).toContain("minecraft:sheep_fluff");
  });

  it("preserves current tree removal materials", () => {
    const plan: Plan = {
      intent: "remove_tree",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 2, y: 72, z: 2 },
      },
      assumptions: [],
      passes: [
        {
          name: "remove_logs",
          goal: "Remove logs.",
          primitives: [
            {
              type: "replace_in_region",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 2, y: 72, z: 2 },
              fromBlock: "minecraft:oak_log",
              toBlock: "minecraft:air",
            },
          ],
        },
      ],
      reply: "Removing that tree.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, request);

    expect(resolved.needsMoreInfo).toBe(false);
    expect(resolved.passes[0]?.primitives[0]).toEqual({
      type: "replace_in_region",
      from: { x: 0, y: 64, z: 0 },
      to: { x: 2, y: 72, z: 2 },
      fromBlock: "minecraft:oak_log",
      toBlock: "minecraft:air",
    });
  });
});
