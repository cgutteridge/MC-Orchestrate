import type { ChatCommandRequest } from "../types/plugin.js";
import {
  safetyPlanRegionWorldMismatchMessage,
  safetyPrimitiveVolumeExceededMessage,
  safetyRegionTooLargeMessage,
  safetyTooFarFromPlayerMessage,
  safetyVolumeExceededMessage,
  safetyWrongWorldMessage,
} from "./playerRefusalMessages.js";
import { normalizeRegion } from "./requestContext.js";
import { estimateLayerMapBlockCount } from "./layerMap.js";
import type { Plan } from "./schema.js";

export const MAX_BLOCKS_PER_REQUEST = 8192;
export const MAX_REGION_WIDTH = 32;
export const MAX_REGION_HEIGHT = 48;
export const MAX_PLAYER_DISTANCE = 32;

/**
 * Enforces the v1 safety envelope for size, distance, and world locality.
 */
export function validatePlanSafety(request: ChatCommandRequest, plan: Plan): string | undefined {
  const targetRegion = normalizeRegion(plan.targetRegion);

  if (targetRegion.world !== plan.targetWorld) {
    return safetyPlanRegionWorldMismatchMessage(plan.targetWorld, targetRegion.world);
  }

  if (plan.targetWorld !== request.player.world) {
    return safetyWrongWorldMessage(request, plan.targetWorld, targetRegion.world);
  }

  const widthX = targetRegion.max.x - targetRegion.min.x + 1;
  const widthY = targetRegion.max.y - targetRegion.min.y + 1;
  const widthZ = targetRegion.max.z - targetRegion.min.z + 1;
  if (widthX > MAX_REGION_WIDTH || widthY > MAX_REGION_HEIGHT || widthZ > MAX_REGION_WIDTH) {
    return safetyRegionTooLargeMessage(widthX, widthY, widthZ, MAX_REGION_WIDTH, MAX_REGION_HEIGHT);
  }

  const volume = widthX * widthY * widthZ;
  if (volume > MAX_BLOCKS_PER_REQUEST) {
    return safetyVolumeExceededMessage(volume, MAX_BLOCKS_PER_REQUEST);
  }

  // The targetRegion bounding-box check above does not account for cylinder
  // primitives, whose block count depends on radius/height rather than the
  // declared region. Check the estimated primitive block count separately so
  // large cylinders cannot bypass the limit.
  const primitiveBlockCount = estimatePlanBlockCount(plan);
  if (primitiveBlockCount > MAX_BLOCKS_PER_REQUEST) {
    return safetyPrimitiveVolumeExceededMessage(primitiveBlockCount, MAX_BLOCKS_PER_REQUEST);
  }

  const dx = Math.abs(
    Math.round((targetRegion.min.x + targetRegion.max.x) / 2) -
      Math.round(request.player.position.x),
  );
  const dz = Math.abs(
    Math.round((targetRegion.min.z + targetRegion.max.z) / 2) -
      Math.round(request.player.position.z),
  );
  if (dx > MAX_PLAYER_DISTANCE || dz > MAX_PLAYER_DISTANCE) {
    return safetyTooFarFromPlayerMessage(dx, dz, MAX_PLAYER_DISTANCE);
  }

  return undefined;
}

/** Sums {@link estimateLayerMapBlockCount} across all passes. */
function estimatePlanBlockCount(plan: Plan): number {
  let total = 0;
  for (const pass of plan.passes) {
    total += estimateLayerMapBlockCount(pass.layerMap);
  }
  return total;
}
