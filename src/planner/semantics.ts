import {
  SEMANTICS_PASS_ORDER,
  semanticsDegenerateStructureMessage,
} from "./playerRefusalMessages.js";
import { normalizeCuboid, normalizeRegion } from "./requestContext.js";
import type { Plan, Point, Primitive } from "./schema.js";

/**
 * Validates that the plan is semantically coherent: pass ordering is valid and
 * the structure has non-degenerate dimensions for its stated intent.
 *
 * Returns a player-facing rejection reason when a violation is found, or
 * `undefined` when the plan is safe to compile and execute.
 */
export function validatePlanSemantics(plan: Plan): string | undefined {
  const orderViolation = detectPassOrderViolation(plan);
  if (orderViolation) {
    return orderViolation;
  }

  const layerPassCount = plan.passes.filter((p) => p.layerMap).length;
  if (layerPassCount > 2) {
    return (
      "This plan has more than two layer-map passes. Use one pass for the complete structure " +
      "(a single layerMap for the whole build) and at most one optional second pass for refinement " +
      "(do not split the build across many passes)."
    );
  }

  const degenerateViolation = detectDegenerateStructure(plan);
  if (degenerateViolation) {
    return degenerateViolation;
  }

  return undefined;
}

/**
 * Intents that imply a meaningful 3-D structure. Plans with these intents must
 * occupy at least a minimum bounding box or they are considered degenerate.
 */
const STRUCTURE_INTENTS = new Set([
  "build_tower",
  "build_house",
  "build_cottage",
  "build_barn",
  "build_bridge",
  "build_gazebo",
]);

/**
 * Minimum bounding-box volume for a structure to be considered non-degenerate.
 * 1×1×1 = 1 and 1×1×2 = 2 are clearly wrong for any structure intent;
 * 1×5×1 = 5 is a valid tower column and should pass.
 */
/** Minimum bounding-box volume for structure intents; exported for tests/messages. */
export const MIN_STRUCTURE_VOLUME = 4;

/**
 * Detects plans where the bounding box is so small that the AI almost certainly
 * produced bad coordinates (e.g. `from == to` for a house).
 *
 * The check is intentionally lenient — it only catches single-block or
 * two-block regions, not narrow-but-legitimate shapes like a 1-wide tower.
 * `set_block`-only plans are exempt because they are deliberate point placements.
 */
function detectDegenerateStructure(plan: Plan): string | undefined {
  if (!STRUCTURE_INTENTS.has(plan.intent)) {
    return undefined;
  }
  if (plan.needsMoreInfo || plan.passes.length === 0) {
    return undefined;
  }

  // set_block-only plans are deliberate point placements, not structures.
  const hasFillPrimitive = plan.passes.some(
    (pass) =>
      pass.layerMap !== undefined ||
      pass.primitives.some(
        (p) =>
          p.type === "fill_cuboid" ||
          p.type === "hollow_cuboid" ||
          p.type === "cylinder",
      ),
  );
  if (!hasFillPrimitive) {
    return undefined;
  }

  const region = normalizeRegion(plan.targetRegion);
  const dx = region.max.x - region.min.x + 1;
  const dy = region.max.y - region.min.y + 1;
  const dz = region.max.z - region.min.z + 1;
  const volume = dx * dy * dz;

  if (volume < MIN_STRUCTURE_VOLUME) {
    return semanticsDegenerateStructureMessage(volume, MIN_STRUCTURE_VOLUME);
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
            return SEMANTICS_PASS_ORDER;
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
