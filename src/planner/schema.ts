import { z } from "zod";
import { validateLayerMapShape } from "./layerMap.js";

export const IntentSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9_]+$/);

export const PointSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  z: z.number().int(),
});

export const RegionSchema = z.object({
  world: z.string().min(1),
  min: PointSchema,
  max: PointSchema,
});

/**
 * Character-layer voxel grid. Layers are ordered **bottom → top** (`layers[0]` =
 * lowest Y); each layer is newline-separated rows. **` ` (space)** means leave that cell unchanged (no-op).
 * **`_`** means place air (default `minecraft:air` if `_` is omitted from `palette`).
 */
export const LayerMapSchema = z
  .object({
    layers: z.array(z.string()).min(1),
    palette: z.record(z.string(), z.string().min(1)),
  })
  .superRefine((data, ctx) => {
    const err = validateLayerMapShape(data);
    if (err) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
    }
  });

export type LayerMap = z.infer<typeof LayerMapSchema>;

/** One build pass: a layer map in local space; the plan's `targetRegion.min` anchors it in the world. */
export const PassSchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  layerMap: LayerMapSchema,
});

export const PlanSchema = z.object({
  intent: IntentSchema,
  targetWorld: z.string().min(1),
  targetRegion: RegionSchema,
  assumptions: z.array(z.string().min(1)).default([]),
  passes: z.array(PassSchema).min(1),
  reply: z.string().min(1),
  /**
   * Step-3 rationale: how the layer diagram implements the locked design and player request.
   * Populated by the model; defaulted when absent for legacy plans.
   */
  briefFulfilment: z
    .string()
    .min(1)
    .max(2000)
    .default("Matches the locked design volume and materials."),
});

export type Point = z.infer<typeof PointSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type BuildPass = z.infer<typeof PassSchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// Design loop step — discriminated union returned by the AI each turn.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Placement intent — AI declares WHERE to place the structure using a strict
// reference + offset vocabulary. The code resolves this to world coordinates.
// ---------------------------------------------------------------------------

/** Anchor reference for placement intent. */
export const PlacementRefSchema = z.enum(["player", "focus"]);

/** Horizontal frame for signed-axis offsets. */
export const PlacementFrameSchema = z.enum(["player", "world"]);

/**
 * Signed offsets:
 * - Player frame: `F` (+forward/-back), `R` (+right/-left)
 * - World frame: `N` (+north/-south), `E` (+east/-west)
 * - Vertical: `UP` (+up/-down)
 */
export const PlacementOffsetSchema = z.object({
  F: z.number().int().default(0),
  R: z.number().int().default(0),
  N: z.number().int().default(0),
  E: z.number().int().default(0),
  UP: z.number().int().default(0),
});

const positiveIntegerFromNumberOrString = (max: number) =>
  z.preprocess((value) => {
    if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return value;
  }, z.number().int().min(1).max(max));

/**
 * Declared footprint and height for step 1 (placement — get location). The layer
 * map in step 2 should match these bounds (within the usual 32×32×48 limits).
 */
export const DesiredSizeSchema = z.object({
  /** Extent along local +X (layer-map columns). */
  width: positiveIntegerFromNumberOrString(32),
  /** Extent along local +Z (layer-map rows within a slice). */
  depth: positiveIntegerFromNumberOrString(32),
  /** Extent along local Y (number of layer strings). */
  height: positiveIntegerFromNumberOrString(48),
});

/**
 * Which point on the structure's axis-aligned box aligns with the semantic
 * anchor from {@link PlacementRefSchema} and offsets.
 *
 * - `on_ground` — anchor at bottom face (normal buildings sitting on ground; structure goes up).
 * - `under_ground` — anchor at top face (excavations like trenches/pools; structure goes down from ground level).
 * - `flying` — anchor at vertical center (floating builds in air; not tied to ground).
 */
export const VerticalReferenceSchema = z.enum(["on_ground", "under_ground", "flying"]);

/**
 * Semantic placement instruction returned by the AI.
 *
 * Offsets are signed axes under `offset`:
 * - `frame="player"`: use `F`, `R`, and `UP` (set `N=0`, `E=0`)
 * - `frame="world"`: use `N`, `E`, and `UP` (set `F=0`, `R=0`)
 */
export const PlacementSchema = z.object({
  ref: PlacementRefSchema.default("player"),
  frame: PlacementFrameSchema.default("player"),
  offset: PlacementOffsetSchema.default({ F: 0, R: 0, N: 0, E: 0, UP: 0 }),

  /**
   * Optional declared size. Required for `placement_choice` in the split loop;
   * guides step 2 and should match `targetRegion` / layer-map bounds.
   */
  desiredSize: DesiredSizeSchema.optional(),
  /**
   * Which vertical face or centre of the build volume sits on the resolved
   * anchor point after offsets. Defaults to `on_ground` for most builds.
   */
  verticalReference: VerticalReferenceSchema.default("on_ground"),
});

export type PlacementRef = z.infer<typeof PlacementRefSchema>;
export type PlacementFrame = z.infer<typeof PlacementFrameSchema>;
export type PlacementOffset = z.infer<typeof PlacementOffsetSchema>;
export type DesiredSize = z.infer<typeof DesiredSizeSchema>;
export type VerticalReference = z.infer<typeof VerticalReferenceSchema>;
export type Placement = z.infer<typeof PlacementSchema>;

/**
 * Step 1 placement: anchor and offsets only — **no size** (size is chosen in the
 * design step).
 */
export const PlacementPositionOnlySchema = PlacementSchema.omit({ desiredSize: true });

/**
 * Placement with locked footprint from design + position steps (used when merging
 * and for execution).
 */
export const PlacementWithDesiredSizeSchema = PlacementSchema.extend({
  desiredSize: DesiredSizeSchema,
});

/**
 * @deprecated Use {@link PlacementWithDesiredSizeSchema} — kept for smoke fixtures.
 */
export const PlacementChoicePlacementSchema = PlacementWithDesiredSizeSchema;

/**
 * Placement-only step for step 1 (first AI call). Size is **not** included; the
 * design step chooses {@link DesiredSizeSchema}.
 */
export const PlacementChoiceStepSchema = z.object({
  action: z.literal("placement_choice"),
  placement: PlacementPositionOnlySchema,
});

/**
 * Step 2: only this phase receives full material-registry context. Produces a
 * prose guide for the builder, recommended materials, footprint size, and a
 * short design summary. No world position.
 */
export const DesignChoiceStepSchema = z.object({
  action: z.literal("design_choice"),
  /** One-line description of the aesthetic / structure. */
  designSummary: z.string().min(1),
  /** Prose instructions for the layer-map builder (step 3). */
  builderGuide: z.string().min(1),
  desiredSize: DesiredSizeSchema,
  /** Vertical anchor point for the structure. */
  verticalReference: VerticalReferenceSchema.default("on_ground"),
  /** Vanilla `minecraft:` block ids to prefer in palettes (step 3). */
  recommendedMaterials: z
    .array(z.string().min(1))
    .min(1)
    .max(48)
    .transform((arr) => arr.map((id) => (id.startsWith("minecraft:") ? id : `minecraft:${id}`))),
});

export const BuildStepSchema = z.object({
  action: z.literal("build"),
  placement: PlacementSchema,
  plan: PlanSchema,
});

/** Discriminated union of every valid AI response during placement-design-build planning. */
export const DesignStepSchema = z.discriminatedUnion("action", [
  PlacementChoiceStepSchema,
  DesignChoiceStepSchema,
  BuildStepSchema,
]);

export type PlacementPositionOnly = z.infer<typeof PlacementPositionOnlySchema>;
export type PlacementWithDesiredSize = z.infer<typeof PlacementWithDesiredSizeSchema>;
export type PlacementChoiceStep = z.infer<typeof PlacementChoiceStepSchema>;
export type DesignChoiceStep = z.infer<typeof DesignChoiceStepSchema>;
export type BuildStep = z.infer<typeof BuildStepSchema>;
export type DesignStep = z.infer<typeof DesignStepSchema>;
