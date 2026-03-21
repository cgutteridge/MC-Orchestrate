import { z } from "zod";

export const IntentSchema = z.enum([
  "remove_tree",
  "build_tower",
  "build_house",
  "unknown",
]);

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
