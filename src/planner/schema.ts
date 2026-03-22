import { z } from "zod";

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

export const PrimitiveSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_block"),
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
    block: z.string().min(1),
  }),
  z.object({
    type: z.literal("fill_cuboid"),
    from: PointSchema,
    to: PointSchema,
    block: z.string().min(1),
  }),
  z.object({
    type: z.literal("hollow_cuboid"),
    from: PointSchema,
    to: PointSchema,
    block: z.string().min(1),
  }),
  z.object({
    type: z.literal("clear_region"),
    from: PointSchema,
    to: PointSchema,
  }),
  z.object({
    type: z.literal("replace_in_region"),
    from: PointSchema,
    to: PointSchema,
    fromBlock: z.string().min(1),
    toBlock: z.string().min(1),
  }),
  z.object({
    type: z.literal("cylinder"),
    center: PointSchema,
    radius: z.number().int().min(1).max(16),
    height: z.number().int().min(1).max(32),
    block: z.string().min(1),
    hollow: z.boolean().default(false),
    axis: z.enum(["x", "y", "z"]).default("y"),
  }),
]);

export const PassSchema = z.object({
  name: z.string().min(1),
  goal: z.string().min(1),
  primitives: z.array(PrimitiveSchema).min(1),
});

export const PlanSchema = z.object({
  intent: IntentSchema,
  targetWorld: z.string().min(1),
  targetRegion: RegionSchema,
  assumptions: z.array(z.string().min(1)).default([]),
  passes: z.array(PassSchema),
  reply: z.string().min(1),
  needsMoreInfo: z.boolean(),
  clarification: z.string().optional(),
});

export type Point = z.infer<typeof PointSchema>;
export type Region = z.infer<typeof RegionSchema>;
export type Primitive = z.infer<typeof PrimitiveSchema>;
export type BuildPass = z.infer<typeof PassSchema>;
export type Intent = z.infer<typeof IntentSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// ---------------------------------------------------------------------------
// Design loop step — discriminated union returned by the AI each turn.
// ---------------------------------------------------------------------------

/**
 * Returned when the AI needs more world context before it can commit to a plan.
 * The orchestrator fulfils the scan and feeds the result back as the next user
 * message before calling the AI again.
 */
export const ViewRequestSchema = z.object({
  action: z.literal("view_request"),
  /** The world region the AI wants to examine. Must be within safety limits. */
  region: RegionSchema,
  /**
   * The AI's private reasoning for this scan and its intentions for the next
   * turn. Echoed back verbatim so the AI retains context across messages.
   */
  selfNotes: z.string().min(1),
});

/**
 * Returned when the AI is ready to execute a build plan.
 * `verifyRegion` is optional: when present the orchestrator reads that region
 * after building and feeds the result back so the AI can issue a polish pass.
 */
export const BuildStepSchema = z.object({
  action: z.literal("build"),
  plan: PlanSchema,
  /**
   * Optional region to inspect after the plan executes. When provided the
   * orchestrator performs a verification pass and gives the AI a chance to
   * refine the result.
   */
  verifyRegion: RegionSchema.optional(),
});

/** Discriminated union of every valid AI response during the design loop. */
export const DesignStepSchema = z.discriminatedUnion("action", [
  ViewRequestSchema,
  BuildStepSchema,
]);

export type ViewRequest = z.infer<typeof ViewRequestSchema>;
export type BuildStep = z.infer<typeof BuildStepSchema>;
export type DesignStep = z.infer<typeof DesignStepSchema>;
