import { z } from "zod";
import { PointSchema, type Plan, type Primitive } from "./schema.js";

// ---------------------------------------------------------------------------
// DIG geometry schema
// ---------------------------------------------------------------------------

export const DigGeometrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fill_cuboid"),
    from: PointSchema,
    to: PointSchema,
  }),
  z.object({
    type: z.literal("hollow_cuboid"),
    from: PointSchema,
    to: PointSchema,
  }),
  z.object({
    type: z.literal("cylinder"),
    center: PointSchema,
    radius: z.number().int().min(1).max(16),
    height: z.number().int().min(1).max(32),
    hollow: z.boolean(),
    axis: z.enum(["x", "y", "z"]),
  }),
  z.object({
    type: z.literal("set_block"),
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
]);

export type DigGeometry = z.infer<typeof DigGeometrySchema>;

// ---------------------------------------------------------------------------
// DIG part: one geometric element with a stable id and material slot reference
// ---------------------------------------------------------------------------

export const DigPartSchema = z.object({
  /**
   * Stable deterministic id — format: `${passName}:${primitiveIndex}`.
   * Persists across revisions so patches can reliably target the same element.
   */
  partId: z.string().min(1),
  /** Human-readable label from the parent pass. */
  name: z.string().min(1),
  /**
   * Material slot key (e.g. "wall", "roof", "floor", "trim", "detail").
   * The DIG's materialSlots map resolves this to a concrete block id.
   */
  slotId: z.string().min(1),
  geometry: DigGeometrySchema,
});

export type DigPart = z.infer<typeof DigPartSchema>;

// ---------------------------------------------------------------------------
// Material slot: maps a semantic slot to a concrete (or symbolic) block id
// ---------------------------------------------------------------------------

export const DigMaterialSlotSchema = z.object({
  slotId: z.string().min(1),
  block: z.string().min(1),
});

export type DigMaterialSlot = z.infer<typeof DigMaterialSlotSchema>;

// ---------------------------------------------------------------------------
// Patch operations
// ---------------------------------------------------------------------------

export const DigPatchSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set_material"),
    slotId: z.string().min(1),
    block: z.string().min(1),
  }),
  z.object({
    op: z.literal("scale_height"),
    partId: z.string().min(1),
    deltaY: z.number().int(),
  }),
  z.object({
    op: z.literal("scale_footprint"),
    partId: z.string().min(1),
    deltaXZ: z.number().int(),
  }),
]);

export type DigPatch = z.infer<typeof DigPatchSchema>;

// ---------------------------------------------------------------------------
// Design Intent Graph
// ---------------------------------------------------------------------------

export const DesignIntentGraphSchema = z.object({
  /**
   * Deterministic id derived from the intent and initial plan structure.
   * Changes when a new build replaces the old one.
   */
  digId: z.string().min(1),
  intent: z.string().min(1),
  targetWorld: z.string().min(1),
  playerUuid: z.string().min(1),
  revision: z.number().int().min(0),
  parts: z.array(DigPartSchema).min(1),
  materialSlots: z.array(DigMaterialSlotSchema),
});

export type DesignIntentGraph = z.infer<typeof DesignIntentGraphSchema>;

// ---------------------------------------------------------------------------
// Pass-name → material slot inference
// ---------------------------------------------------------------------------

const PASS_SLOT_MAP: Record<string, string> = {
  walls: "wall",
  shell: "wall",
  body: "wall",
  tower_column: "wall",
  structure_extension: "wall",
  structure_footprint_expand: "wall",
  build_pass: "wall",
  roof: "roof",
  gabled_roof: "roof",
  roof_cap: "roof",
  floor: "floor",
  walkway: "floor",
  platform: "wood",
  posts: "trim",
  railing_left: "detail",
  railing_right: "detail",
};

function inferSlotId(passName: string): string {
  return PASS_SLOT_MAP[passName] ?? "body";
}

// ---------------------------------------------------------------------------
// Block extraction from a plan primitive
// ---------------------------------------------------------------------------

function extractBlock(primitive: Primitive): string | undefined {
  switch (primitive.type) {
    case "fill_cuboid":
    case "hollow_cuboid":
    case "cylinder":
      return primitive.block;
    case "set_block":
      return primitive.block;
    case "clear_region":
    case "replace_in_region":
      return undefined;
  }
}

function extractGeometry(primitive: Primitive): DigGeometry | undefined {
  switch (primitive.type) {
    case "fill_cuboid":
      return { type: "fill_cuboid", from: primitive.from, to: primitive.to };
    case "hollow_cuboid":
      return { type: "hollow_cuboid", from: primitive.from, to: primitive.to };
    case "cylinder":
      return {
        type: "cylinder",
        center: primitive.center,
        radius: primitive.radius,
        height: primitive.height,
        hollow: primitive.hollow,
        axis: primitive.axis,
      };
    case "set_block":
      return { type: "set_block", x: primitive.x, y: primitive.y, z: primitive.z };
    case "clear_region":
    case "replace_in_region":
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Plan → DIG
// ---------------------------------------------------------------------------

/**
 * Converts an executed plan into a Design Intent Graph, ready to persist for
 * follow-up revision.
 *
 * The `digId` is derived deterministically from the intent and player id so
 * it is stable for the same build-replace cycle. Part ids are deterministic
 * positional keys (`${passName}:${index}`) so patches can reliably target them
 * across revisions.
 */
export function compilePlanToDig(
  plan: Plan,
  playerUuid: string,
): DesignIntentGraph {
  const digId = `${plan.intent}:${playerUuid}:${plan.targetWorld}`;
  const parts: DigPart[] = [];
  const slotBlockMap = new Map<string, string>();

  for (const pass of plan.passes) {
    for (const [index, primitive] of pass.primitives.entries()) {
      const geometry = extractGeometry(primitive);
      const block = extractBlock(primitive);
      if (!geometry || !block) {
        continue;
      }

      const slotId = inferSlotId(pass.name);
      const partId = `${pass.name}:${index}`;

      parts.push(
        DigPartSchema.parse({ partId, name: pass.name, slotId, geometry }),
      );

      // Last block wins per slot (most specific wins on repeat slot usage).
      slotBlockMap.set(slotId, block);
    }
  }

  const materialSlots: DigMaterialSlot[] = [...slotBlockMap.entries()].map(
    ([slotId, block]) => ({ slotId, block }),
  );

  return DesignIntentGraphSchema.parse({
    digId,
    intent: plan.intent,
    targetWorld: plan.targetWorld,
    playerUuid,
    revision: 0,
    parts,
    materialSlots,
  });
}

// ---------------------------------------------------------------------------
// DIG → Plan
// ---------------------------------------------------------------------------

/**
 * Compiles the current state of a DIG back into a Plan for execution.
 *
 * Each part's `slotId` is resolved to the current block in `materialSlots`.
 * Parts are grouped by pass name to reconstruct the original pass structure.
 */
export function compileDigToPlan(dig: DesignIntentGraph): Plan {
  const slotToBlock = new Map(
    dig.materialSlots.map(({ slotId, block }) => [slotId, block]),
  );

  // Group parts by pass name, preserving insertion order.
  const passesByName = new Map<string, DigPart[]>();
  for (const part of dig.parts) {
    const list = passesByName.get(part.name) ?? [];
    list.push(part);
    passesByName.set(part.name, list);
  }

  const passes: Plan["passes"] = [];

  for (const [passName, parts] of passesByName) {
    const primitives: Plan["passes"][number]["primitives"] = [];

    for (const part of parts) {
      const block = slotToBlock.get(part.slotId) ?? "material:wall";
      const geom = part.geometry;

      let primitive: Primitive;
      switch (geom.type) {
        case "fill_cuboid":
          primitive = { type: "fill_cuboid", from: geom.from, to: geom.to, block };
          break;
        case "hollow_cuboid":
          primitive = { type: "hollow_cuboid", from: geom.from, to: geom.to, block };
          break;
        case "cylinder":
          primitive = {
            type: "cylinder",
            center: geom.center,
            radius: geom.radius,
            height: geom.height,
            hollow: geom.hollow,
            axis: geom.axis,
            block,
          };
          break;
        case "set_block":
          primitive = { type: "set_block", x: geom.x, y: geom.y, z: geom.z, block };
          break;
      }

      primitives.push(primitive);
    }

    if (primitives.length > 0) {
      passes.push({
        name: passName,
        goal: `Compiled from DIG revision ${dig.revision}.`,
        primitives,
      });
    }
  }

  // Compute bounding box from all fill/hollow/cylinder parts.
  const allXs: number[] = [];
  const allYs: number[] = [];
  const allZs: number[] = [];

  for (const part of dig.parts) {
    const g = part.geometry;
    if (g.type === "fill_cuboid" || g.type === "hollow_cuboid") {
      allXs.push(g.from.x, g.to.x);
      allYs.push(g.from.y, g.to.y);
      allZs.push(g.from.z, g.to.z);
    } else if (g.type === "cylinder") {
      allXs.push(g.center.x - g.radius, g.center.x + g.radius);
      allYs.push(g.center.y, g.center.y + g.height - 1);
      allZs.push(g.center.z - g.radius, g.center.z + g.radius);
    } else if (g.type === "set_block") {
      allXs.push(g.x);
      allYs.push(g.y);
      allZs.push(g.z);
    }
  }

  const min = {
    x: Math.min(...allXs),
    y: Math.min(...allYs),
    z: Math.min(...allZs),
  };
  const max = {
    x: Math.max(...allXs),
    y: Math.max(...allYs),
    z: Math.max(...allZs),
  };

  return {
    intent: dig.intent,
    targetWorld: dig.targetWorld,
    targetRegion: { world: dig.targetWorld, min, max },
    assumptions: [`DIG revision ${dig.revision}.`],
    passes,
    reply: "Rebuilt from design intent.",
    needsMoreInfo: false,
  };
}

// ---------------------------------------------------------------------------
// Patch application
// ---------------------------------------------------------------------------

/**
 * Applies a single patch to a DIG, returning the updated graph with an
 * incremented revision.
 *
 * Patch application is idempotent: applying the same `set_material` patch
 * twice yields the same result as applying it once.
 */
export function applyDigPatch(
  dig: DesignIntentGraph,
  patch: DigPatch,
): DesignIntentGraph {
  switch (patch.op) {
    case "set_material": {
      const existing = dig.materialSlots.find((s) => s.slotId === patch.slotId);
      if (existing?.block === patch.block) {
        return dig; // idempotent — no change
      }
      const materialSlots = [
        ...dig.materialSlots.filter((s) => s.slotId !== patch.slotId),
        { slotId: patch.slotId, block: patch.block },
      ];
      return DesignIntentGraphSchema.parse({
        ...dig,
        revision: dig.revision + 1,
        materialSlots,
      });
    }

    case "scale_height": {
      const parts = dig.parts.map((part) => {
        if (part.partId !== patch.partId) {
          return part;
        }
        const g = part.geometry;
        if (g.type === "fill_cuboid" || g.type === "hollow_cuboid") {
          return {
            ...part,
            geometry: {
              ...g,
              to: { ...g.to, y: g.to.y + patch.deltaY },
            },
          };
        }
        if (g.type === "cylinder") {
          return {
            ...part,
            geometry: {
              ...g,
              height: Math.max(1, g.height + patch.deltaY),
            },
          };
        }
        return part;
      });
      return DesignIntentGraphSchema.parse({
        ...dig,
        revision: dig.revision + 1,
        parts,
      });
    }

    case "scale_footprint": {
      const parts = dig.parts.map((part) => {
        if (part.partId !== patch.partId) {
          return part;
        }
        const g = part.geometry;
        const d = patch.deltaXZ;
        if (g.type === "fill_cuboid" || g.type === "hollow_cuboid") {
          return {
            ...part,
            geometry: {
              ...g,
              from: { ...g.from, x: g.from.x - d, z: g.from.z - d },
              to: { ...g.to, x: g.to.x + d, z: g.to.z + d },
            },
          };
        }
        if (g.type === "cylinder") {
          return {
            ...part,
            geometry: { ...g, radius: Math.max(1, Math.min(16, g.radius + d)) },
          };
        }
        return part;
      });
      return DesignIntentGraphSchema.parse({
        ...dig,
        revision: dig.revision + 1,
        parts,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic render digest
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic digest string from the DIG's current parts and
 * material slots. Identical DIGs always produce the same digest, making it
 * suitable for regression comparison and change detection.
 */
export function computeDigDigest(dig: DesignIntentGraph): string {
  const sortedParts = [...dig.parts].sort((a, b) =>
    a.partId.localeCompare(b.partId),
  );
  const sortedSlots = [...dig.materialSlots].sort((a, b) =>
    a.slotId.localeCompare(b.slotId),
  );
  return JSON.stringify({ parts: sortedParts, slots: sortedSlots });
}
