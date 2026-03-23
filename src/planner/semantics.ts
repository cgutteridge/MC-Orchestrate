import { semanticsDegenerateStructureMessage } from "./playerRefusalMessages.js";
import { normalizeRegion } from "./requestContext.js";
import type { Plan } from "./schema.js";

/**
 * Validates that the plan is semantically coherent: layer-map pass count and
 * non-degenerate structure dimensions for the stated intent.
 *
 * Returns a player-facing rejection reason when a violation is found, or
 * `undefined` when the plan is safe to compile and execute.
 */
export function validatePlanSemantics(plan: Plan): string | undefined {
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
  if (plan.passes.length === 0) {
    return undefined;
  }

  const hasLayerFill = plan.passes.some((pass) => pass.layerMap !== undefined);
  if (!hasLayerFill) {
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
