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

  it("resolves symbolic material slots using local nearby context", () => {
    const plan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 3, y: 68, z: 3 },
      },
      assumptions: [],
      passes: [
        {
          name: "shell",
          goal: "Build shell with symbolic slots.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 3, y: 67, z: 3 },
              block: "material:wall",
            },
            {
              type: "fill_cuboid",
              from: { x: 0, y: 68, z: 0 },
              to: { x: 3, y: 68, z: 3 },
              block: "material:roof",
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, {
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [
          { x: 0, y: 64, z: 0, type: "minecraft:cobblestone" },
          { x: 1, y: 64, z: 0, type: "minecraft:cobblestone" },
          { x: 2, y: 64, z: 0, type: "minecraft:cobblestone" },
          { x: 3, y: 64, z: 0, type: "minecraft:stone_bricks" },
        ],
      },
    });

    expect(resolved.needsMoreInfo).toBe(false);
    expect(resolved.passes[0]?.primitives[0]).toMatchObject({
      block: "minecraft:cobblestone",
    });
    expect(resolved.passes[0]?.primitives[1]).toMatchObject({
      block: "minecraft:cobblestone_stairs",
    });
  });

  it("resolves spruce roof slots from explicit player preference", () => {
    const plan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 3, y: 68, z: 3 },
      },
      assumptions: [],
      passes: [
        {
          name: "roof",
          goal: "Build roof.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 68, z: 0 },
              to: { x: 3, y: 68, z: 3 },
              block: "slot:roof",
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, {
      ...request,
      message: "build me a spruce roof house",
    });

    expect(resolved.passes[0]?.primitives[0]).toMatchObject({
      block: "minecraft:spruce_stairs",
    });
  });

  it("resolves symbolic toBlock in replace_in_region using context", () => {
    const plan: Plan = {
      intent: "renovate_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 3, y: 68, z: 3 },
      },
      assumptions: [],
      passes: [
        {
          name: "replace_walls",
          goal: "Replace existing wall with new material.",
          primitives: [
            {
              type: "replace_in_region",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 3, y: 68, z: 3 },
              fromBlock: "minecraft:cobblestone",
              toBlock: "material:wall",
            },
          ],
        },
      ],
      reply: "Replacing walls.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, {
      ...request,
      message: "replace the walls with stone bricks",
    });

    expect(resolved.needsMoreInfo).toBe(false);
    expect(resolved.passes[0]?.primitives[0]).toMatchObject({
      type: "replace_in_region",
      fromBlock: "minecraft:cobblestone",
      toBlock: expect.stringMatching(/^minecraft:/),
    });
  });

  it("resolves alternate slot prefix formats ($wall, {{wall}}, wall_material, material.wall)", () => {
    const makePlan = (block: string): Plan => ({
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
          goal: "Build shell.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 1, y: 65, z: 1 },
              block,
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    });

    const formats = ["$wall", "{{wall}}", "wall_material", "material.wall"];
    for (const fmt of formats) {
      const resolved = resolvePlanMaterials(makePlan(fmt), request);
      expect(resolved.needsMoreInfo, `format "${fmt}" should resolve`).toBe(false);
      expect(
        resolved.passes[0]?.primitives[0],
        `format "${fmt}" should produce a concrete block`,
      ).toMatchObject({ block: expect.stringMatching(/^minecraft:/) });
    }
  });

  it("resolves {{ wall }} (with interior spaces) the same as {{wall}}", () => {
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
          goal: "Build shell.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 1, y: 65, z: 1 },
              block: "{{ wall }}",
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, request);

    expect(resolved.needsMoreInfo).toBe(false);
    expect(resolved.passes[0]?.primitives[0]).toMatchObject({
      block: expect.stringMatching(/^minecraft:/),
    });
  });

  it("does not inflate woodWeight for stone stair variants in nearby blocks", () => {
    const plan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 3, y: 68, z: 3 },
      },
      assumptions: [],
      passes: [
        {
          name: "shell",
          goal: "Build shell.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 3, y: 68, z: 3 },
              block: "material:wall",
            },
          ],
        },
      ],
      reply: "Building it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, {
      ...request,
      localContext: {
        ...request.localContext,
        nearbyBlocks: [
          { x: 0, y: 64, z: 0, type: "minecraft:stone_brick_stairs" },
          { x: 1, y: 64, z: 0, type: "minecraft:stone_brick_stairs" },
          { x: 2, y: 64, z: 0, type: "minecraft:stone_brick_stairs" },
          { x: 3, y: 64, z: 0, type: "minecraft:stone_brick_stairs" },
        ],
      },
    });

    expect(resolved.needsMoreInfo).toBe(false);
    const primitive = resolved.passes[0]?.primitives[0];
    expect(primitive).toMatchObject({ block: expect.stringMatching(/stone/) });
  });

  it("rejects fluid blocks used as structural build materials", () => {
    const plan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 3, y: 68, z: 3 },
      },
      assumptions: [],
      passes: [
        {
          name: "walls",
          goal: "Fill walls with water (invalid).",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 3, y: 68, z: 3 },
              block: "minecraft:water",
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
    expect(resolved.clarification).toContain("minecraft:water");
  });

  it("allows fluid blocks in replace_in_region operational contexts", () => {
    const plan: Plan = {
      intent: "fill_pool",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 3, y: 64, z: 3 },
      },
      assumptions: [],
      passes: [
        {
          name: "fill",
          goal: "Fill pool with water.",
          primitives: [
            {
              type: "replace_in_region",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 3, y: 64, z: 3 },
              fromBlock: "minecraft:air",
              toBlock: "minecraft:water",
            },
          ],
        },
      ],
      reply: "Filling it.",
      needsMoreInfo: false,
    };

    const resolved = resolvePlanMaterials(plan, request);

    expect(resolved.needsMoreInfo).toBe(false);
    expect(resolved.passes[0]?.primitives[0]).toMatchObject({
      fromBlock: "minecraft:air",
      toBlock: "minecraft:water",
    });
  });

  it("asks for clarification when a symbolic material slot is unknown", () => {
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
          goal: "Build shell.",
          primitives: [
            {
              type: "fill_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 1, y: 65, z: 1 },
              block: "material:chimney",
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
    expect(resolved.clarification).toContain("material:chimney");
  });
});
