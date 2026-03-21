import { describe, expect, it } from "vitest";
import { validatePlanSemantics } from "./semantics.js";
import type { Plan } from "./schema.js";

const baseRegion = {
  world: "world",
  min: { x: 0, y: 64, z: 0 },
  max: { x: 6, y: 70, z: 6 },
};

function makePlan(passes: Plan["passes"]): Plan {
  return {
    intent: "build_house",
    targetWorld: "world",
    targetRegion: baseRegion,
    assumptions: [],
    passes,
    reply: "Building.",
    needsMoreInfo: false,
  };
}

describe("validatePlanSemantics", () => {
  it("passes a normal multi-pass build plan", () => {
    const plan = makePlan([
      {
        name: "walls",
        goal: "Build walls.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 6, y: 70, z: 6 },
            block: "minecraft:stone",
          },
        ],
      },
      {
        name: "details",
        goal: "Add windows.",
        primitives: [
          {
            type: "set_block",
            x: 3,
            y: 67,
            z: 0,
            block: "minecraft:glass",
          },
        ],
      },
    ]);

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });

  it("passes a fill-then-hollow-interior pattern", () => {
    // fill 6×6×6, then clear the 4×4×4 interior — this is valid hollowing
    const plan = makePlan([
      {
        name: "shell",
        goal: "Fill solid block.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 6, y: 70, z: 6 },
            block: "minecraft:stone",
          },
        ],
      },
      {
        name: "hollow",
        goal: "Clear interior.",
        primitives: [
          {
            type: "clear_region",
            from: { x: 1, y: 65, z: 1 },
            to: { x: 5, y: 69, z: 5 },
          },
        ],
      },
    ]);

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });

  it("rejects a plan that clears the same region it just filled", () => {
    const plan = makePlan([
      {
        name: "build",
        goal: "Build structure.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 6, y: 70, z: 6 },
            block: "minecraft:stone",
          },
        ],
      },
      {
        name: "undo",
        goal: "Clear region.",
        primitives: [
          {
            type: "clear_region",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 6, y: 70, z: 6 },
          },
        ],
      },
    ]);

    expect(validatePlanSemantics(plan)).toContain("undo its own");
  });

  it("rejects a plan where a larger clear encloses an earlier fill", () => {
    const plan = makePlan([
      {
        name: "build",
        goal: "Build tower.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: 1, y: 65, z: 1 },
            to: { x: 5, y: 69, z: 5 },
            block: "minecraft:cobblestone",
          },
        ],
      },
      {
        name: "wipe",
        goal: "Clear wider area.",
        primitives: [
          {
            type: "clear_region",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 6, y: 70, z: 6 },
          },
        ],
      },
    ]);

    expect(validatePlanSemantics(plan)).toContain("undo its own");
  });

  it("rejects a plan where replace-with-air encloses an earlier fill", () => {
    const plan = makePlan([
      {
        name: "build",
        goal: "Build structure.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 4, y: 68, z: 4 },
            block: "minecraft:stone",
          },
        ],
      },
      {
        name: "remove",
        goal: "Remove via replace.",
        primitives: [
          {
            type: "replace_in_region",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 4, y: 68, z: 4 },
            fromBlock: "minecraft:stone",
            toBlock: "minecraft:air",
          },
        ],
      },
    ]);

    expect(validatePlanSemantics(plan)).toContain("undo its own");
  });

  it("passes a replace-with-non-air in a prior-build region (material swap)", () => {
    // replace_in_region changing stone → glass is a valid restyle, not destructive
    const plan = makePlan([
      {
        name: "build",
        goal: "Build walls.",
        primitives: [
          {
            type: "fill_cuboid",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 4, y: 68, z: 4 },
            block: "minecraft:stone",
          },
        ],
      },
      {
        name: "restyle",
        goal: "Add glass windows.",
        primitives: [
          {
            type: "replace_in_region",
            from: { x: 0, y: 64, z: 0 },
            to: { x: 4, y: 68, z: 4 },
            fromBlock: "minecraft:stone",
            toBlock: "minecraft:glass",
          },
        ],
      },
    ]);

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });

  it("passes a plan with no passes", () => {
    const plan = makePlan([]);
    expect(validatePlanSemantics(plan)).toBeUndefined();
  });
});
