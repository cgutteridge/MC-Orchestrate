import { describe, expect, it } from "vitest";
import {
  compileBridgeTemplate,
  compileCottageTemplate,
  compileTowerTemplate,
} from "./templates.js";
import type { BridgeParams, CottageParams, TowerParams } from "./templates.js";

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
// Bridge
// ---------------------------------------------------------------------------

describe("compileBridgeTemplate", () => {
  const base: BridgeParams = {
    world: "world",
    walkwayFrom: { x: 0, y: 64, z: -1 },
    walkwayTo: { x: 7, y: 64, z: 1 },
    axis: "x",
    railings: true,
    walkBlock: "material:floor",
    railBlock: "material:detail",
  };

  it("produces a deterministic plan for the same params", () => {
    const a = compileBridgeTemplate(base);
    const b = compileBridgeTemplate(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("sets intent to build_bridge", () => {
    expect(compileBridgeTemplate(base).intent).toBe("build_bridge");
  });

  it("emits walkway + 2 railing passes for a 3-wide bridge", () => {
    const plan = compileBridgeTemplate(base);
    expect(plan.passes).toHaveLength(3);
    expect(plan.passes[0]?.name).toBe("walkway");
    expect(plan.passes[1]?.name).toBe("railing_left");
    expect(plan.passes[2]?.name).toBe("railing_right");
  });

  it("places railings one block above the walkway at both z-edges for axis=x", () => {
    const plan = compileBridgeTemplate(base);
    // Left railing: z = walkwayFrom.z = -1
    expect(plan.passes[1]?.primitives[0]).toMatchObject({
      type: "fill_cuboid",
      from: { z: -1, y: 65 },
      to: { z: -1, y: 65 },
      block: "material:detail",
    });
    // Right railing: z = walkwayTo.z = 1
    expect(plan.passes[2]?.primitives[0]).toMatchObject({
      type: "fill_cuboid",
      from: { z: 1, y: 65 },
      to: { z: 1, y: 65 },
      block: "material:detail",
    });
  });

  it("emits only walkway pass when railings is false", () => {
    const plan = compileBridgeTemplate({ ...base, railings: false });
    expect(plan.passes).toHaveLength(1);
  });

  it("emits only walkway pass for a 1-wide bridge even if railings requested", () => {
    const narrow: BridgeParams = {
      ...base,
      walkwayFrom: { x: 0, y: 64, z: 0 },
      walkwayTo: { x: 7, y: 64, z: 0 },
    };
    const plan = compileBridgeTemplate(narrow);
    expect(plan.passes).toHaveLength(1);
  });

  it("stays within safety budget for maximum length", () => {
    const long: BridgeParams = {
      ...base,
      walkwayFrom: { x: 0, y: 64, z: -1 },
      walkwayTo: { x: 15, y: 64, z: 1 },
    };
    const plan = compileBridgeTemplate(long);
    const dx = plan.targetRegion.max.x - plan.targetRegion.min.x + 1;
    const dz = plan.targetRegion.max.z - plan.targetRegion.min.z + 1;
    expect(dx).toBeLessThanOrEqual(16);
    expect(dz).toBeLessThanOrEqual(16);
  });

  it("correctly places railings at x-edges for axis=z", () => {
    const zBridge: BridgeParams = {
      world: "world",
      walkwayFrom: { x: -1, y: 64, z: 0 },
      walkwayTo: { x: 1, y: 64, z: 7 },
      axis: "z",
      railings: true,
      walkBlock: "material:floor",
      railBlock: "material:detail",
    };
    const plan = compileBridgeTemplate(zBridge);
    // Left railing: x = walkwayFrom.x = -1
    expect(plan.passes[1]?.primitives[0]).toMatchObject({
      from: { x: -1, y: 65 },
      to: { x: -1, y: 65 },
    });
    // Right railing: x = walkwayTo.x = 1
    expect(plan.passes[2]?.primitives[0]).toMatchObject({
      from: { x: 1, y: 65 },
      to: { x: 1, y: 65 },
    });
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
