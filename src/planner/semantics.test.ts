import { describe, expect, it } from "vitest";
import { validatePlanSemantics } from "./semantics.js";
import { LAYER_MAP_1x1x1_STONE } from "./layerMapFixtures.js";
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
    briefFulfilment: "Semantics fixture.",
  };
}

describe("validatePlanSemantics", () => {
  it("passes a normal multi-pass layer-map plan", () => {
    const plan = makePlan([
      {
        name: "walls",
        goal: "Build walls.",
        layerMap: {
          layers: ["SSS", "S_S", "SSS"],
          palette: { S: "minecraft:stone", _: "minecraft:air" },
        },
      },
      {
        name: "details",
        goal: "Add trim.",
        layerMap: {
          layers: ["G"],
          palette: { G: "minecraft:glass", _: "minecraft:air" },
        },
      },
    ]);

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Degenerate structure checks
// ---------------------------------------------------------------------------

describe("validatePlanSemantics — degenerate structure", () => {
  function makeBuildPlan(
    intent: string,
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
  ): Plan {
    return {
      intent,
      targetWorld: "world",
      targetRegion: { world: "world", min, max },
      assumptions: [],
      passes: [
        {
          name: "body",
          goal: "Build.",
          layerMap: LAYER_MAP_1x1x1_STONE,
        },
      ],
      reply: "Building.",
      briefFulfilment: "Degenerate structure test fixture.",
    };
  }

  it("rejects a structure plan whose bounding box is a single block (from == to)", () => {
    const plan = makeBuildPlan("build_house", { x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 0 });

    expect(validatePlanSemantics(plan)).toContain("footprint is only");
  });

  it("passes a 1-wide tower column because narrow structures are valid", () => {
    const plan = makeBuildPlan("build_tower", { x: 0, y: 64, z: 0 }, { x: 0, y: 72, z: 0 });

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });

  it("passes a properly-sized structure plan", () => {
    const plan = makeBuildPlan("build_tower", { x: -1, y: 64, z: -1 }, { x: 1, y: 72, z: 1 });

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });

  it("does not apply degenerate check to non-structure intents", () => {
    const plan = makeBuildPlan("remove_tree", { x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 0 });

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });

  const tinyLayerMap = {
    layers: ["S"],
    palette: { S: "minecraft:stone", _: "minecraft:air" },
  };

  it("allows two layer-map passes (full build plus optional refinement)", () => {
    const plan = makePlan([
      {
        name: "main",
        goal: "Complete structure.",
        layerMap: tinyLayerMap,
      },
      {
        name: "refine",
        goal: "Polish.",
        layerMap: {
          layers: ["S"],
          palette: { S: "minecraft:stone_bricks", _: "minecraft:air" },
        },
      },
    ]);

    expect(validatePlanSemantics(plan)).toBeUndefined();
  });

  it("rejects more than two layer-map passes", () => {
    const pass = {
      name: "p",
      goal: "g",
      layerMap: tinyLayerMap,
    };
    const plan = makePlan([pass, pass, pass]);
    expect(validatePlanSemantics(plan)).toContain("more than two");
  });
});
