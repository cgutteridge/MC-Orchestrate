import { describe, expect, it } from "vitest";
import { compilePlanToBridgeCommands } from "./compilePlan.js";
import { LAYER_MAP_1x1x1_STONE, LAYER_MAP_3x1x1_GLASS } from "./layerMapFixtures.js";
import type { Plan } from "./schema.js";

describe("compilePlanToBridgeCommands", () => {
  it("compiles multi-pass layer-map plans into batchSet bridge commands", () => {
    const plan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 0, y: 64, z: 0 },
      },
      assumptions: [],
      passes: [
        {
          name: "first",
          goal: "First slice.",
          layerMap: LAYER_MAP_1x1x1_STONE,
        },
        {
          name: "second",
          goal: "Second slice.",
          layerMap: {
            layers: ["B"],
            palette: { B: "minecraft:stone_bricks", _: "minecraft:air" },
          },
        },
      ],
      reply: "Building.",
      briefFulfilment: "Multi-pass compile test.",
    };

    const commands = compilePlanToBridgeCommands(plan);
    expect(commands.length).toBeGreaterThanOrEqual(2);
    expect(commands.every((c) => c.kind === "batchSet")).toBe(true);
  });

  it("compiles a wider footprint layer map into batchSet operations", () => {
    const plan: Plan = {
      intent: "build_path",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 2, y: 64, z: 0 },
      },
      assumptions: [],
      passes: [
        {
          name: "path",
          goal: "Glass strip.",
          layerMap: LAYER_MAP_3x1x1_GLASS,
        },
      ],
      reply: "Building.",
      briefFulfilment: "Glass path matches strip footprint.",
    };

    const commands = compilePlanToBridgeCommands(plan);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.kind).toBe("batchSet");
    if (commands[0]?.kind === "batchSet") {
      expect(commands[0].blocks.length).toBe(3);
    }
  });
});
