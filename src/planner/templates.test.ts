import { describe, expect, it } from "vitest";
import {
  compileBarnTemplate,
  compileBridgeTemplate,
  compileCottageTemplate,
  compileGazeboTemplate,
  compileTowerTemplate,
} from "./templates.js";
import type {
  BarnParams,
  BridgeParams,
  CottageParams,
  GazeboParams,
  TowerParams,
} from "./templates.js";

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

// ---------------------------------------------------------------------------
// Barn
// ---------------------------------------------------------------------------

describe("compileBarnTemplate", () => {
  const base: BarnParams = {
    world: "world",
    origin: { x: 0, y: 64, z: 0 },
    width: 12,
    depth: 8,
    wallHeight: 4,
    wallBlock: "material:wall",
    roofBlock: "material:roof",
  };

  it("produces a deterministic plan for the same params", () => {
    const a = compileBarnTemplate(base);
    const b = compileBarnTemplate(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("sets intent to build_barn", () => {
    expect(compileBarnTemplate(base).intent).toBe("build_barn");
  });

  it("emits walls pass then gabled_roof pass", () => {
    const plan = compileBarnTemplate(base);
    expect(plan.passes[0]?.name).toBe("walls");
    expect(plan.passes[1]?.name).toBe("gabled_roof");
    expect(plan.passes[0]?.primitives[0]).toMatchObject({ type: "hollow_cuboid" });
  });

  it("gabled roof for depth=8 has 3 fill_cuboid layers stepping inward by 1 on each side", () => {
    const plan = compileBarnTemplate(base);
    const roofPrimitives = plan.passes[1]?.primitives ?? [];
    // depth=8 → 3 roof layers
    expect(roofPrimitives).toHaveLength(3);
    // Layer 0: z=1..6 (1 inset from each side of 0..7)
    expect(roofPrimitives[0]).toMatchObject({ from: { z: 1 }, to: { z: 6 } });
    // Layer 1: z=2..5
    expect(roofPrimitives[1]).toMatchObject({ from: { z: 2 }, to: { z: 5 } });
    // Layer 2 (ridge): z=3..4
    expect(roofPrimitives[2]).toMatchObject({ from: { z: 3 }, to: { z: 4 } });
  });

  it("roof ridge sits above wall top", () => {
    const plan = compileBarnTemplate(base);
    // wallHeight=4, origin.y=64 → wallTop=67; first roof layer y=68
    expect(plan.passes[1]?.primitives[0]).toMatchObject({ from: { y: 68 } });
  });

  it("bounding box covers walls + all roof layers", () => {
    const plan = compileBarnTemplate(base);
    // 3 roof layers: y=68, 69, 70 → max.y = 70
    expect(plan.targetRegion.max.y).toBe(70);
  });

  it("stays within safety budget for default params", () => {
    const plan = compileBarnTemplate(base);
    const dx = plan.targetRegion.max.x - plan.targetRegion.min.x + 1;
    const dz = plan.targetRegion.max.z - plan.targetRegion.min.z + 1;
    expect(dx).toBeLessThanOrEqual(16);
    expect(dz).toBeLessThanOrEqual(16);
  });
});

// ---------------------------------------------------------------------------
// Gazebo
// ---------------------------------------------------------------------------

describe("compileGazeboTemplate", () => {
  const base: GazeboParams = {
    world: "world",
    center: { x: 0, y: 64, z: 0 },
    radius: 4,
    postHeight: 4,
    platformBlock: "material:wood",
    postBlock: "material:trim",
    roofBlock: "material:roof",
  };

  it("produces a deterministic plan for the same params", () => {
    const a = compileGazeboTemplate(base);
    const b = compileGazeboTemplate(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("sets intent to build_gazebo", () => {
    expect(compileGazeboTemplate(base).intent).toBe("build_gazebo");
  });

  it("emits three passes: platform, posts, roof_cap", () => {
    const plan = compileGazeboTemplate(base);
    expect(plan.passes).toHaveLength(3);
    expect(plan.passes[0]?.name).toBe("platform");
    expect(plan.passes[1]?.name).toBe("posts");
    expect(plan.passes[2]?.name).toBe("roof_cap");
  });

  it("platform is a hollow cylinder at ground level", () => {
    const plan = compileGazeboTemplate(base);
    expect(plan.passes[0]?.primitives[0]).toMatchObject({
      type: "cylinder",
      hollow: true,
      axis: "y",
      radius: 4,
      height: 1,
      center: { x: 0, y: 64, z: 0 },
    });
  });

  it("posts pass has 4 fill_cuboid primitives at N/S/E/W positions", () => {
    const plan = compileGazeboTemplate(base);
    const posts = plan.passes[1]?.primitives ?? [];
    expect(posts).toHaveLength(4);
    // North post: z = center.z + radius = 4
    expect(posts[0]).toMatchObject({ from: { z: 4 }, to: { z: 4 } });
    // South post: z = center.z - radius = -4
    expect(posts[1]).toMatchObject({ from: { z: -4 }, to: { z: -4 } });
  });

  it("roof cap is a solid cylinder at the top of the posts", () => {
    const plan = compileGazeboTemplate(base);
    // roofY = center.y + postHeight + 1 = 64 + 4 + 1 = 69
    expect(plan.passes[2]?.primitives[0]).toMatchObject({
      type: "cylinder",
      hollow: false,
      center: { y: 69 },
      radius: 4,
    });
  });
});
