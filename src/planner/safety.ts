import type { ChatCommandRequest } from "../types/plugin.js";
import { normalizeRegion } from "./requestContext.js";
import type { Plan } from "./schema.js";

const MAX_BLOCKS_PER_REQUEST = 2048;
const MAX_REGION_WIDTH = 16;
const MAX_REGION_HEIGHT = 32;

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
