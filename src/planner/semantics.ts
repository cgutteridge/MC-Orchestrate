import { normalizeCuboid } from "./requestContext.js";
import type { Plan, Point, Primitive } from "./schema.js";

/**
 * Validates that the plan's pass ordering is semantically coherent.
 *
 * Returns a player-facing rejection reason when a violation is found, or
 * `undefined` when the plan is safe to compile and execute.
 */
export function validatePlanSemantics(plan: Plan): string | undefined {
  const violation = detectPassOrderViolation(plan);
  if (violation) {
    return violation;
  }
  return undefined;
}

/**
 * Detects plans where a destructive primitive (clear or replace-with-air)
 * would completely undo the work of an earlier build primitive by operating
 * on a region that contains or equals the earlier build region.
 *
 * Hollowing is not flagged: a clear that is strictly smaller than and inside
 * a prior fill is a legitimate interior-clear pattern.
 */
function detectPassOrderViolation(plan: Plan): string | undefined {
  const buildRegions: Array<{ from: Point; to: Point }> = [];

  for (const pass of plan.passes) {
    for (const primitive of pass.primitives) {
      if (isDestructivePrimitive(primitive)) {
        const dest = normalizeCuboid(primitive.from, primitive.to);
        for (const build of buildRegions) {
          const b = normalizeCuboid(build.from, build.to);
          if (regionContains(dest, b)) {
            return "That plan would undo its own earlier build steps. Please revise the pass order.";
          }
        }
      } else if (isBuildPrimitive(primitive)) {
        buildRegions.push({ from: primitive.from, to: primitive.to });
      }
    }
  }

  return undefined;
}

function isDestructivePrimitive(
  primitive: Primitive,
): primitive is Extract<
  Primitive,
  { type: "clear_region" | "replace_in_region" }
> {
  if (primitive.type === "clear_region") {
    return true;
  }
  if (
    primitive.type === "replace_in_region" &&
    primitive.toBlock === "minecraft:air"
  ) {
    return true;
  }
  return false;
}

function isBuildPrimitive(
  primitive: Primitive,
): primitive is Extract<
  Primitive,
  { type: "fill_cuboid" | "hollow_cuboid"; from: Point; to: Point }
> {
  return (
    primitive.type === "fill_cuboid" || primitive.type === "hollow_cuboid"
  );
}

/**
 * Returns `true` when `outer` contains or equals `inner` in all three axes.
 * A destructive outer region that fully contains a prior build region means
 * the build was pointless — the plan is self-contradictory.
 */
function regionContains(
  outer: { from: Point; to: Point },
  inner: { from: Point; to: Point },
): boolean {
  return (
    outer.from.x <= inner.from.x &&
    outer.to.x >= inner.to.x &&
    outer.from.y <= inner.from.y &&
    outer.to.y >= inner.to.y &&
    outer.from.z <= inner.from.z &&
    outer.to.z >= inner.to.z
  );
}
