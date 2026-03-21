import { describe, expect, it } from "vitest";
import { compileCottageTemplate, compileTowerTemplate } from "./templates.js";
import type { CottageParams, TowerParams } from "./templates.js";

// ---------------------------------------------------------------------------
// Tower
// ---------------------------------------------------------------------------

describe("compileTowerTemplate", () => {
  const base: TowerParams = {
    world: "world",
    anchor: { x: 0, y: 64, z: 0 },
    height: 8,
    width: 3,
    hollow: false,
    block: "material:wall",
  };

  it("produces a deterministic plan for the same params", () => {
    const a = compileTowerTemplate(base);
    const b = compileTowerTemplate(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("sets intent to build_tower", () => {
    expect(compileTowerTemplate(base).intent).toBe("build_tower");
  });

  it("computes correct bounding box for a 3×3×8 tower anchored at (0,64,0)", () => {
    const plan = compileTowerTemplate(base);
    // width=3, half=1 → from x=-1 to x=1, z=-1 to z=1; y=64 to y=71
    expect(plan.targetRegion.min).toEqual({ x: -1, y: 64, z: -1 });
    expect(plan.targetRegion.max).toEqual({ x: 1, y: 71, z: 1 });
    expect(plan.passes[0]?.primitives[0]).toMatchObject({
      type: "fill_cuboid",
      from: { x: -1, y: 64, z: -1 },
      to: { x: 1, y: 71, z: 1 },
      block: "material:wall",
    });
  });

  it("uses hollow_cuboid when hollow is true", () => {
    const plan = compileTowerTemplate({ ...base, hollow: true });
    expect(plan.passes[0]?.primitives[0]).toMatchObject({
      type: "hollow_cuboid",
    });
  });

  it("centres even-width footprints correctly", () => {
    const plan = compileTowerTemplate({ ...base, width: 4 });
    // width=4, half=2 → from x=-2, to x=1 (width-half-1=1)
    expect(plan.targetRegion.min.x).toBe(-2);
    expect(plan.targetRegion.max.x).toBe(1);
  });

  it("stays within safety budget for maximum params", () => {
    const maxPlan = compileTowerTemplate({ ...base, height: 16, width: 8 });
    const min = maxPlan.targetRegion.min;
    const max = maxPlan.targetRegion.max;
    const dx = max.x - min.x + 1;
    const dy = max.y - min.y + 1;
    const dz = max.z - min.z + 1;
    expect(dx).toBeLessThanOrEqual(16);
    expect(dy).toBeLessThanOrEqual(32);
    expect(dz).toBeLessThanOrEqual(16);
  });

  it("sets needsMoreInfo to false", () => {
    expect(compileTowerTemplate(base).needsMoreInfo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cottage
// ---------------------------------------------------------------------------

describe("compileCottageTemplate", () => {
  const base: CottageParams = {
    world: "world",
    origin: { x: 0, y: 64, z: 0 },
    width: 7,
    depth: 7,
    wallHeight: 4,
    wallBlock: "material:wall",
    roofBlock: "material:roof",
  };

  it("produces a deterministic plan for the same params", () => {
    const a = compileCottageTemplate(base);
    const b = compileCottageTemplate(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("sets intent to build_cottage", () => {
    expect(compileCottageTemplate(base).intent).toBe("build_cottage");
  });

  it("emits two passes: shell then roof", () => {
    const plan = compileCottageTemplate(base);
    expect(plan.passes).toHaveLength(2);
    expect(plan.passes[0]?.name).toBe("shell");
    expect(plan.passes[1]?.name).toBe("roof");
  });

  it("shell uses hollow_cuboid for the walls", () => {
    const plan = compileCottageTemplate(base);
    expect(plan.passes[0]?.primitives[0]).toMatchObject({
      type: "hollow_cuboid",
      block: "material:wall",
    });
  });

  it("roof slab sits one block above the shell ceiling", () => {
    const plan = compileCottageTemplate(base);
    // shell top y = 64 + 4 - 1 = 67; roof y = 68
    expect(plan.passes[1]?.primitives[0]).toMatchObject({
      type: "fill_cuboid",
      from: { y: 68 },
      to: { y: 68 },
      block: "material:roof",
    });
  });

  it("bounding box covers shell + roof layer", () => {
    const plan = compileCottageTemplate(base);
    expect(plan.targetRegion.min).toEqual({ x: 0, y: 64, z: 0 });
    expect(plan.targetRegion.max).toEqual({ x: 6, y: 68, z: 6 });
  });

  it("stays within safety budget for default params", () => {
    const plan = compileCottageTemplate(base);
    const min = plan.targetRegion.min;
    const max = plan.targetRegion.max;
    const dx = max.x - min.x + 1;
    const dy = max.y - min.y + 1;
    const dz = max.z - min.z + 1;
    expect(dx).toBeLessThanOrEqual(16);
    expect(dy).toBeLessThanOrEqual(32);
    expect(dz).toBeLessThanOrEqual(16);
  });
});
