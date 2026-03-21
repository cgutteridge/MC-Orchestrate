import { describe, expect, it } from "vitest";
import { compilePlanToBridgeCommands } from "./compilePlan.js";
import type { Plan } from "./schema.js";

describe("compilePlanToBridgeCommands", () => {
  it("compiles multi-pass plans into bridge commands", () => {
    // arrange
    const plan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 6, y: 69, z: 6 },
      },
      assumptions: [],
      passes: [
        {
          name: "shell",
          goal: "Build a shell.",
          primitives: [
            {
              type: "hollow_cuboid",
              from: { x: 0, y: 64, z: 0 },
              to: { x: 6, y: 68, z: 6 },
              block: "minecraft:oak_planks",
            },
          ],
        },
      ],
      reply: "Building.",
      needsMoreInfo: false,
    };

    // act
    const commands = compilePlanToBridgeCommands(plan);

    // assert
    expect(commands).toHaveLength(2);
    expect(commands[0]?.kind).toBe("fill");
    expect(commands[1]?.kind).toBe("fill");
  });

  it("compiles cylinders as batchSet operations", () => {
    // arrange
    const plan: Plan = {
      intent: "build_tower",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 2, y: 68, z: 2 },
      },
      assumptions: [],
      passes: [
        {
          name: "tower",
          goal: "Cylinder tower.",
          primitives: [
            {
              type: "cylinder",
              center: { x: 0, y: 64, z: 0 },
              radius: 2,
              height: 5,
              block: "minecraft:stone",
              hollow: true,
              axis: "y",
            },
          ],
        },
      ],
      reply: "Building.",
      needsMoreInfo: false,
    };

    // act
    const commands = compilePlanToBridgeCommands(plan);

    // assert
    expect(commands).toHaveLength(1);
    expect(commands[0]?.kind).toBe("batchSet");
    if (commands[0]?.kind === "batchSet") {
      expect(commands[0].blocks.length).toBeGreaterThan(0);
    }
  });

  it("does not emit an inverted inner clear for thin hollow cuboids", () => {
    // arrange
    const plan: Plan = {
      intent: "build_house",
      targetWorld: "world",
      targetRegion: {
        world: "world",
        min: { x: 0, y: 64, z: 0 },
        max: { x: 1, y: 66, z: 1 },
      },
      assumptions: [],
      passes: [
        {
          name: "thin_shell",
          goal: "Build a minimal shell.",
          primitives: [
            {
              type: "hollow_cuboid",
              from: { x: 1, y: 66, z: 1 },
              to: { x: 0, y: 64, z: 0 },
              block: "minecraft:glass",
            },
          ],
        },
      ],
      reply: "Building.",
      needsMoreInfo: false,
    };

    // act
    const commands = compilePlanToBridgeCommands(plan);

    // assert
    expect(commands).toEqual([
      {
        kind: "fill",
        from: { x: 0, y: 64, z: 0 },
        to: { x: 1, y: 66, z: 1 },
        block: "minecraft:glass",
      },
    ]);
  });
});
