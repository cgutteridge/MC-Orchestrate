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
 * Character-layer voxel grid. Layers are ordered **top → bottom**; each layer is
 * newline-separated rows. **` ` (space)** means leave that cell unchanged (no-op).
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

/**
 * The placement reference. Encodes both the ORIGIN POINT and the ROTATION
 * system used to interpret horizontal offsets.
 *
 * - `player_view`     — origin at player position; offsets use player-facing
 *                       directions (forward/back/left/right)
 * - `player_absolute` — origin at player position; offsets use world cardinal
 *                       directions (north/south/east/west)
 * - `focus`           — origin at the looked-at block (targetBlock); offsets
 *                       are cardinal; or no offsets for "right here/on this"
 * - `last_build`      — origin at the centre of the last built structure;
 *                       for follow-up requests like "make it bigger"
 */
export const PlacementRefSchema = z.enum(["player_view", "player_absolute", "focus", "last_build"]);

/**
 * Declared footprint and height for step 1 (placement — get location). The layer
 * map in step 2 should match these bounds (within the usual 32×32×48 limits).
 */
export const DesiredSizeSchema = z.object({
  /** Extent along local +X (layer-map columns). */
  width: z.number().int().min(1).max(32),
  /** Extent along local +Z (layer-map rows within a slice). */
  depth: z.number().int().min(1).max(32),
  /** Extent along local Y (number of layer strings). */
  height: z.number().int().min(1).max(48),
});

/**
 * Which point on the structure's axis-aligned box aligns with the semantic
 * anchor from {@link PlacementRefSchema} and offsets.
 *
 * - `top` — anchor at the top face (e.g. ground surface for an excavated pool).
 * - `bottom` — anchor at the bottom face (structures sitting on the ground).
 * - `middle` — anchor at the vertical centre (floating builds, spans above/below).
 * - `flying` — same alignment as `middle` today; reserved for richer plan-step prompts.
 */
export const VerticalReferenceSchema = z.enum(["top", "middle", "bottom", "flying"]);

/**
 * Semantic placement instruction returned by the AI.
 *
 * **Y is independent of horizontal offsets.** `up: 0` (default) = ground
 * level at the resolved XZ position. `up: N` = N blocks above ground.
 * `down: N` = N blocks below ground (for pits, pools). Aerial builds should
 * use a minimum of `up: 2` to clear the player's head.
 *
 * Horizontal offsets depend on `ref`:
 * - `player_view`:     use `forward`, `back`, `left`, `right`
 * - `player_absolute`: use `north`, `south`, `east`, `west`
 * - `focus`:           use `north`, `south`, `east`, `west` (or none = "here")
 * - `last_build`:      use `north`, `south`, `east`, `west` (or none = "extend it")
 */
export const PlacementSchema = z.object({
  ref: PlacementRefSchema.default("player_view"),

  /**
   * Optional declared size. Required for `placement_choice` in the split loop;
   * guides step 2 and should match `targetRegion` / layer-map bounds.
   */
  desiredSize: DesiredSizeSchema.optional(),
  /**
   * Which vertical face or centre of the build volume sits on the resolved
   * anchor point after offsets. Defaults to `middle` for backward compatibility.
   */
  verticalReference: VerticalReferenceSchema.default("middle"),

  // Player-view offsets (only used when ref = "player_view")
  /** Blocks in the player's look direction. */
  forward: z.number().int().default(0),
  /** Blocks opposite the player's look direction. */
  back: z.number().int().default(0),
  /** Blocks to the player's left (left of look direction). */
  left: z.number().int().default(0),
  /** Blocks to the player's right (right of look direction). */
  right: z.number().int().default(0),

  // Cardinal offsets (used when ref = "player_absolute", "focus", or "last_build")
  north: z.number().int().default(0),
  south: z.number().int().default(0),
  east: z.number().int().default(0),
  west: z.number().int().default(0),

  // Vertical — always independent of horizontal, relative to ground level at
  // the resolved XZ position.
  /** Blocks above ground level at target XZ. Minimum 2 for aerial builds. */
  up: z.number().int().min(0).default(0),
  /** Blocks below ground level (for pits, pools, underground builds). */
  down: z.number().int().min(0).default(0),
});

export type PlacementRef = z.infer<typeof PlacementRefSchema>;
export type DesiredSize = z.infer<typeof DesiredSizeSchema>;
export type VerticalReference = z.infer<typeof VerticalReferenceSchema>;
export type Placement = z.infer<typeof PlacementSchema>;

/**
 * Returned when the AI is ready to execute a build plan.
 * `verifyRegion` is optional: when present the orchestrator reads that region
 * after building and feeds the result back so the AI can issue a polish pass.
 *
 * `placement` is required: the AI must declare WHERE to put the structure
 * using semantic anchor+offset rather than computing world coordinates itself.
 * Layer maps use local coordinates with (0,0,0) as the structure's bottom-south-west
 * corner; the orchestrator shifts `targetRegion` to world space before executing.
 */

/**
 * Placement object for step 1 of the split loop — includes required
 * {@link DesiredSizeSchema} so size is chosen before the layer map.
 */
export const PlacementChoicePlacementSchema = PlacementSchema.extend({
  desiredSize: DesiredSizeSchema,
});

/**
 * Placement-only step for step 1 (first AI call). The next
 * call requests the layer map; the server merges this `placement` with the plan.
 */
export const PlacementChoiceStepSchema = z.object({
  action: z.literal("placement_choice"),
  placement: PlacementChoicePlacementSchema,
  /** Optional notes echoed on the plan phase turn. */
  selfNotes: z.string().min(1).optional(),
});

export const BuildStepSchema = z.object({
  action: z.literal("build"),
  placement: PlacementSchema,
  plan: PlanSchema,
  /**
   * Optional region to inspect after the plan executes. When provided the
   * orchestrator performs a verification pass and gives the AI a chance to
   * refine the result.
   */
  verifyRegion: RegionSchema.optional(),
});

/** Discriminated union of every valid AI response during placement-then-build planning. */
export const DesignStepSchema = z.discriminatedUnion("action", [
  PlacementChoiceStepSchema,
  BuildStepSchema,
]);

export type PlacementChoiceStep = z.infer<typeof PlacementChoiceStepSchema>;
export type BuildStep = z.infer<typeof BuildStepSchema>;
export type DesignStep = z.infer<typeof DesignStepSchema>;
