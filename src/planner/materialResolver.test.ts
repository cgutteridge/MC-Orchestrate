import { describe, expect, it } from "vitest";
import { MATERIAL_FALLBACK_BLOCK, sanitizePlanMaterials } from "./materialResolver.js";
import type { Plan } from "./schema.js";

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    intent: "test",
    targetWorld: "world",
    targetRegion: {
      world: "world",
      min: { x: 0, y: 64, z: 0 },
      max: { x: 1, y: 65, z: 1 },
    },
    assumptions: [],
    passes: [],
    reply: "ok",
    ...overrides,
  };
}

describe("sanitizePlanMaterials", () => {
  it("leaves valid vanilla ids in palettes unchanged", () => {
    const plan = basePlan({
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
    });
    const { plan: out, replacedIds } = sanitizePlanMaterials(plan);
    expect(replacedIds).toEqual([]);
    expect(out.passes[0]?.layerMap?.palette.S).toBe("minecraft:stone");
  });

  it("replaces unknown palette ids with stone and lists them", () => {
    const plan = basePlan({
      passes: [
        {
          name: "p",
          goal: "g",
          primitives: [],
          layerMap: {
            layers: ["X"],
            palette: { X: "sheep fluff", _: "minecraft:air" },
          },
        },
      ],
    });
    const { plan: out, replacedIds } = sanitizePlanMaterials(plan);
    expect(replacedIds).toContain("sheep fluff");
    expect(out.passes[0]?.layerMap?.palette.X).toBe(MATERIAL_FALLBACK_BLOCK);
  });

  it("replaces symbolic material slots with stone", () => {
    const plan = basePlan({
      passes: [
        {
          name: "p",
          goal: "g",
          primitives: [],
          layerMap: {
            layers: ["S"],
            palette: { S: "material:wall", _: "minecraft:air" },
          },
        },
      ],
    });
    const { plan: out, replacedIds } = sanitizePlanMaterials(plan);
    expect(replacedIds.some((id) => id.includes("material:wall"))).toBe(true);
    expect(out.passes[0]?.layerMap?.palette.S).toBe(MATERIAL_FALLBACK_BLOCK);
  });

  it("normalizes aliases to vanilla ids when recognized", () => {
    const plan = basePlan({
      passes: [
        {
          name: "p",
          goal: "g",
          primitives: [],
          layerMap: {
            layers: ["O"],
            palette: { O: "oak planks", _: "minecraft:air" },
          },
        },
      ],
    });
    const { plan: out, replacedIds } = sanitizePlanMaterials(plan);
    expect(replacedIds).toEqual([]);
    expect(out.passes[0]?.layerMap?.palette.O).toBe("minecraft:oak_planks");
  });
});
