import { describe, expect, it } from "vitest";
import {
  applyDigPatch,
  compilePlanToDig,
  compileDigToPlan,
  computeDigDigest,
} from "./dig.js";
import type { Plan } from "./schema.js";

const playerUuid = "00000000-0000-0000-0000-000000000001";

const towerPlan: Plan = {
  intent: "build_tower",
  targetWorld: "world",
  targetRegion: {
    world: "world",
    min: { x: -1, y: 64, z: -1 },
    max: { x: 1, y: 71, z: 1 },
  },
  assumptions: [],
  passes: [
    {
      name: "tower_column",
      goal: "Build tower.",
      primitives: [
        {
          type: "fill_cuboid",
          from: { x: -1, y: 64, z: -1 },
          to: { x: 1, y: 71, z: 1 },
          block: "minecraft:stone",
        },
      ],
    },
  ],
  reply: "Built.",
  needsMoreInfo: false,
};

const cottagePlan: Plan = {
  intent: "build_cottage",
  targetWorld: "world",
  targetRegion: {
    world: "world",
    min: { x: 0, y: 64, z: 0 },
    max: { x: 6, y: 68, z: 6 },
  },
  assumptions: [],
  passes: [
    {
      name: "shell",
      goal: "Build shell.",
      primitives: [
        {
          type: "hollow_cuboid",
          from: { x: 0, y: 64, z: 0 },
          to: { x: 6, y: 67, z: 6 },
          block: "material:wall",
        },
      ],
    },
    {
      name: "roof",
      goal: "Add roof.",
      primitives: [
        {
          type: "fill_cuboid",
          from: { x: 0, y: 68, z: 0 },
          to: { x: 6, y: 68, z: 6 },
          block: "material:roof",
        },
      ],
    },
  ],
  reply: "Built.",
  needsMoreInfo: false,
};

// ---------------------------------------------------------------------------
// compilePlanToDig
// ---------------------------------------------------------------------------

describe("compilePlanToDig", () => {
  it("produces a DIG with one part per build primitive", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    expect(dig.parts).toHaveLength(1);
    expect(dig.parts[0]?.name).toBe("tower_column");
    expect(dig.parts[0]?.slotId).toBe("wall");
    expect(dig.parts[0]?.geometry).toMatchObject({ type: "fill_cuboid" });
  });

  it("assigns stable deterministic part ids", () => {
    const a = compilePlanToDig(towerPlan, playerUuid);
    const b = compilePlanToDig(towerPlan, playerUuid);
    expect(a.parts[0]?.partId).toBe("tower_column:0");
    expect(a.parts[0]?.partId).toBe(b.parts[0]?.partId);
  });

  it("extracts material slots from the primitives' block fields", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    expect(dig.materialSlots).toEqual([{ slotId: "wall", block: "minecraft:stone" }]);
  });

  it("extracts separate material slots for shell and roof", () => {
    const dig = compilePlanToDig(cottagePlan, playerUuid);
    const slotMap = Object.fromEntries(
      dig.materialSlots.map(({ slotId, block }) => [slotId, block]),
    );
    expect(slotMap["wall"]).toBe("material:wall");
    expect(slotMap["roof"]).toBe("material:roof");
  });

  it("starts at revision 0", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    expect(dig.revision).toBe(0);
  });

  it("sets intent and targetWorld from the plan", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    expect(dig.intent).toBe("build_tower");
    expect(dig.targetWorld).toBe("world");
  });
});

// ---------------------------------------------------------------------------
// compileDigToPlan
// ---------------------------------------------------------------------------

describe("compileDigToPlan", () => {
  it("round-trips a tower plan through DIG without loss of structure", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    const plan = compileDigToPlan(dig);

    expect(plan.intent).toBe("build_tower");
    expect(plan.targetWorld).toBe("world");
    expect(plan.passes).toHaveLength(1);
    expect(plan.passes[0]?.primitives[0]).toMatchObject({
      type: "fill_cuboid",
      from: { x: -1, y: 64, z: -1 },
      to: { x: 1, y: 71, z: 1 },
      block: "minecraft:stone",
    });
  });

  it("round-trips a cottage plan with two passes", () => {
    const dig = compilePlanToDig(cottagePlan, playerUuid);
    const plan = compileDigToPlan(dig);

    expect(plan.passes).toHaveLength(2);
    expect(plan.passes[0]?.name).toBe("shell");
    expect(plan.passes[1]?.name).toBe("roof");
  });

  it("resolves material slots to the current block in the DIG", () => {
    const dig = compilePlanToDig(cottagePlan, playerUuid);
    const plan = compileDigToPlan(dig);
    // Slot "wall" → "material:wall" as stored; "roof" → "material:roof"
    expect(plan.passes[0]?.primitives[0]).toMatchObject({ block: "material:wall" });
    expect(plan.passes[1]?.primitives[0]).toMatchObject({ block: "material:roof" });
  });
});

// ---------------------------------------------------------------------------
// applyDigPatch — set_material
// ---------------------------------------------------------------------------

describe("applyDigPatch set_material", () => {
  it("changes the block for the target slot", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    const patched = applyDigPatch(dig, {
      op: "set_material",
      slotId: "wall",
      block: "minecraft:oak_planks",
    });

    const slot = patched.materialSlots.find((s) => s.slotId === "wall");
    expect(slot?.block).toBe("minecraft:oak_planks");
  });

  it("increments the revision number", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    const patched = applyDigPatch(dig, {
      op: "set_material",
      slotId: "wall",
      block: "minecraft:oak_planks",
    });
    expect(patched.revision).toBe(1);
  });

  it("is idempotent: applying the same patch twice yields the same result as once", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    const patch = { op: "set_material" as const, slotId: "wall", block: "minecraft:oak_planks" };

    const once = applyDigPatch(dig, patch);
    const twice = applyDigPatch(once, patch);

    // Second application finds the block already set → no change, revision unchanged
    expect(twice.revision).toBe(once.revision);
    expect(computeDigDigest(twice)).toBe(computeDigDigest(once));
  });

  it("the patched DIG compiles to a plan with the new block", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    const patched = applyDigPatch(dig, {
      op: "set_material",
      slotId: "wall",
      block: "minecraft:oak_planks",
    });
    const plan = compileDigToPlan(patched);
    expect(plan.passes[0]?.primitives[0]).toMatchObject({ block: "minecraft:oak_planks" });
  });
});

// ---------------------------------------------------------------------------
// applyDigPatch — scale_height
// ---------------------------------------------------------------------------

describe("applyDigPatch scale_height", () => {
  it("extends the 'to.y' of a fill_cuboid part", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    const partId = dig.parts[0]?.partId ?? "";

    const patched = applyDigPatch(dig, { op: "scale_height", partId, deltaY: 3 });

    const part = patched.parts.find((p) => p.partId === partId);
    expect(part?.geometry).toMatchObject({ to: { y: 74 } }); // 71 + 3
    expect(patched.revision).toBe(1);
  });

  it("leaves other parts unchanged", () => {
    const dig = compilePlanToDig(cottagePlan, playerUuid);
    const shellPartId = dig.parts.find((p) => p.name === "shell")?.partId ?? "";
    const roofPartId = dig.parts.find((p) => p.name === "roof")?.partId ?? "";

    const patched = applyDigPatch(dig, { op: "scale_height", partId: shellPartId, deltaY: 2 });

    const roofPart = patched.parts.find((p) => p.partId === roofPartId);
    const roofGeom = roofPart?.geometry;
    // Roof part should be unchanged
    expect(roofGeom).toMatchObject({ from: { y: 68 }, to: { y: 68 } });
  });
});

// ---------------------------------------------------------------------------
// computeDigDigest
// ---------------------------------------------------------------------------

describe("computeDigDigest", () => {
  it("produces the same digest for identical DIGs", () => {
    const a = compilePlanToDig(towerPlan, playerUuid);
    const b = compilePlanToDig(towerPlan, playerUuid);
    expect(computeDigDigest(a)).toBe(computeDigDigest(b));
  });

  it("produces a different digest after a patch changes the material", () => {
    const dig = compilePlanToDig(towerPlan, playerUuid);
    const patched = applyDigPatch(dig, {
      op: "set_material",
      slotId: "wall",
      block: "minecraft:oak_planks",
    });
    expect(computeDigDigest(dig)).not.toBe(computeDigDigest(patched));
  });

  it("is stable regardless of insertion order of parts and slots", () => {
    // Build two DIGs with the same content but potentially different insertion order
    const a = compilePlanToDig(cottagePlan, playerUuid);
    // Manually reverse the parts array — digest should still match
    const bParts = [...a.parts].reverse();
    const bSlots = [...a.materialSlots].reverse();
    const b = { ...a, parts: bParts, materialSlots: bSlots };
    expect(computeDigDigest(a)).toBe(computeDigDigest(b));
  });
});
