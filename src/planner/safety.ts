import type { ChatCommandRequest } from "../types/plugin.js";
import { normalizeCuboid, normalizeRegion } from "./requestContext.js";
import type { Plan, Primitive } from "./schema.js";

const MAX_BLOCKS_PER_REQUEST = 2048;
const MAX_REGION_WIDTH = 16;
const MAX_REGION_HEIGHT = 32;

/**
 * Enforces the v1 safety envelope for size, distance, and world locality.
 */
export function validatePlanSafety(
  request: ChatCommandRequest,
  plan: Plan,
): string | undefined {
  const targetRegion = normalizeRegion(plan.targetRegion);

  if (plan.targetWorld !== request.player.world || targetRegion.world !== plan.targetWorld) {
    return "I only build in your current world.";
  }

  const widthX = targetRegion.max.x - targetRegion.min.x + 1;
  const widthY = targetRegion.max.y - targetRegion.min.y + 1;
  const widthZ = targetRegion.max.z - targetRegion.min.z + 1;
  if (
    widthX > MAX_REGION_WIDTH ||
    widthY > MAX_REGION_HEIGHT ||
    widthZ > MAX_REGION_WIDTH
  ) {
    return "That area is too large for one request.";
  }

  const volume = widthX * widthY * widthZ;
  if (volume > MAX_BLOCKS_PER_REQUEST) {
    return "That would change too many blocks at once.";
  }

  // The targetRegion bounding-box check above does not account for cylinder
  // primitives, whose block count depends on radius/height rather than the
  // declared region. Check the estimated primitive block count separately so
  // large cylinders cannot bypass the limit.
  const primitiveBlockCount = estimatePlanBlockCount(plan);
  if (primitiveBlockCount > MAX_BLOCKS_PER_REQUEST) {
    return "That would change too many blocks at once.";
  }

  const dx = Math.abs(
    Math.round((targetRegion.min.x + targetRegion.max.x) / 2) -
      Math.round(request.player.position.x),
  );
  const dz = Math.abs(
    Math.round((targetRegion.min.z + targetRegion.max.z) / 2) -
      Math.round(request.player.position.z),
  );
  if (dx > 16 || dz > 16) {
    return "That target is too far from you for v1.";
  }

  return undefined;
}

/**
 * Estimates the total number of blocks affected by all primitives in the plan.
 * Uses conservative upper bounds (e.g. solid-cylinder formula) so the check
 * fails closed when the AI over-generates.
 */
function estimatePlanBlockCount(plan: Plan): number {
  let total = 0;
  for (const pass of plan.passes) {
    for (const primitive of pass.primitives) {
      total += estimatePrimitiveBlockCount(primitive);
    }
  }
  return total;
}

function estimatePrimitiveBlockCount(primitive: Primitive): number {
  switch (primitive.type) {
    case "set_block":
      return 1;
    case "fill_cuboid":
    case "hollow_cuboid":
    case "clear_region":
    case "replace_in_region": {
      const { from, to } = normalizeCuboid(primitive.from, primitive.to);
      return (to.x - from.x + 1) * (to.y - from.y + 1) * (to.z - from.z + 1);
    }
    case "cylinder":
      // Solid-cylinder formula as an upper bound regardless of hollow flag.
      return Math.ceil(Math.PI * primitive.radius * primitive.radius * primitive.height);
  }
}
