import type { BridgeCommand } from "../bridge/types.js";
import { compilePlanToBridgeCommands } from "../planner/compilePlan.js";
import { normalizeCuboid } from "../planner/requestContext.js";
import { PlanSchema, type Plan } from "../planner/schema.js";

/**
 * Quantitative metrics for comparing plans in benchmarks and CI (structure,
 * rough cost, palette breadth). Does not measure terrain intrusion (needs world
 * samples) or live execution quality.
 */
export type PlanBenchmarkMetrics = {
  /** True when the input satisfied {@link PlanSchema}. */
  schemaValid: boolean;
  /**
   * Sum of bridge-operation weights: fill/replace volume, batchSet block count,
   * one per setBlock. Aligns with {@link compilePlanToBridgeCommands} output.
   */
  estimatedBridgeOperations: number;
  passCount: number;
  /** Volume of the declared `targetRegion` bounding box (informational). */
  targetRegionVolume: number;
  /** Distinct block ids across all layer-map palettes. */
  paletteDiversity: number;
};

function bridgeCommandWeight(cmd: BridgeCommand): number {
  switch (cmd.kind) {
    case "say":
      return 0;
    case "setBlock":
      return 1;
    case "fill":
    case "replace": {
      const box = normalizeCuboid(cmd.from, cmd.to);
      const dx = box.to.x - box.from.x + 1;
      const dy = box.to.y - box.from.y + 1;
      const dz = box.to.z - box.from.z + 1;
      return dx * dy * dz;
    }
    case "batchSet":
      return cmd.blocks.length;
    default: {
      const _exhaustive: never = cmd;
      return _exhaustive;
    }
  }
}

function collectPaletteBlockIds(plan: Plan): Set<string> {
  const ids = new Set<string>();
  for (const pass of plan.passes) {
    for (const v of Object.values(pass.layerMap.palette)) {
      ids.add(v);
    }
  }
  return ids;
}

function regionVolume(region: Plan["targetRegion"]): number {
  const { min, max } = region;
  return (max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1);
}

/**
 * Parses a value with {@link PlanSchema}, compiles to bridge commands, and
 * returns comparable metrics for benchmarking and regression snapshots.
 *
 * @param plan Candidate plan (typically from AI or a golden JSON fixture).
 * @returns Parsed metrics, or a Zod error message when the plan is invalid.
 */
export function scorePlan(
  plan: unknown,
): { ok: true; metrics: PlanBenchmarkMetrics } | { ok: false; error: string } {
  const parsed = PlanSchema.safeParse(plan);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  const p = parsed.data;
  const commands = compilePlanToBridgeCommands(p);
  let estimatedBridgeOperations = 0;
  for (const c of commands) {
    estimatedBridgeOperations += bridgeCommandWeight(c);
  }

  return {
    ok: true,
    metrics: {
      schemaValid: true,
      estimatedBridgeOperations,
      passCount: p.passes.length,
      targetRegionVolume: regionVolume(p.targetRegion),
      paletteDiversity: collectPaletteBlockIds(p).size,
    },
  };
}
