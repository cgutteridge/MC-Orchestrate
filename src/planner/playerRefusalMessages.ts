/**
 * Player-facing explanations for planner and orchestrator refusal paths.
 * Keep wording concrete: name the limit, suggest what to do next.
 *
 */

import type { ChatCommandRequest } from "../types/plugin.js";

/**
 * Explains why placement-then-build planning stopped without a plan: the model
 * failed repeatedly or the AI step budget was exhausted.
 *
 * @param kind - Whether the assistant failed twice in a row or steps ran out.
 * @param request - Used to quote a short snippet of the player's message.
 */
export function aiPlanFailureMessage(
  kind: "max_steps" | "assistant_failed_twice",
  request: ChatCommandRequest,
): string {
  const hint = truncateForPlayer(request.message, 72);

  if (kind === "assistant_failed_twice") {
    return (
      `I couldn't lock in a valid build plan: the assistant gave two responses in a row that I couldn't use ` +
      `(missing JSON, broken JSON, or a plan that didn't match the required shape). ` +
      `Your request looked like: "${hint}". ` +
      `Try again with a shorter, single-structure ask (size + material + "in front of me" / "here"). ` +
      `If this keeps happening, it's likely a model output issue on our side—not something you did wrong.`
    );
  }

  return (
    `I ran out of planning steps while working on: "${hint}". ` +
    `Break it into a smaller ask (one structure, explicit size and placement), or say exactly what block type and footprint you want.`
  );
}

/**
 * Player-facing message when a plan would have no executable passes (defensive path).
 */
export function orchestratorEmptyPlanMessage(request: ChatCommandRequest): string {
  const hint = truncateForPlayer(request.message, 72);
  return (
    `I couldn't turn that into placeable blocks. For "${hint}", say what to build, roughly how big ` +
    `(e.g. "about 9 blocks wide"), and where (e.g. "8 blocks in front of me" or "here on this block").`
  );
}

/**
 * Unexpected throwable from orchestration (network, bridge, bugs).
 *
 * @param message - Error message or stringified cause.
 */
export function orchestratorUnexpectedErrorMessage(message: string): string {
  const safe = message.trim().slice(0, 200);
  return (
    `Something unexpected went wrong in the builder: ${safe}. ` +
    `Try again. If it repeats, try a shorter message or check server logs.`
  );
}

/**
 * @param snippet - Player message (already truncated).
 */
export function safetyWrongWorldMessage(
  request: ChatCommandRequest,
  planWorld: string,
  regionWorld: string,
): string {
  return (
    `Safety: I only build in the world you are standing in ("${request.player.world}"). ` +
    `This plan used targetWorld="${planWorld}" and region.world="${regionWorld}". ` +
    `Ask again from that world, or rephrase so the build stays in your current dimension.`
  );
}

/**
 * When `targetRegion.world` disagrees with `plan.targetWorld` (incoherent plan metadata).
 */
export function safetyPlanRegionWorldMismatchMessage(
  targetWorld: string,
  regionWorld: string,
): string {
  return (
    `Safety: the plan's targetWorld is "${targetWorld}" but targetRegion.world is "${regionWorld}". ` +
    `Those must match each other and your current world. Regenerate or fix the plan metadata.`
  );
}

/**
 * @param widthX - Bounding box size on X.
 * @param widthY - On Y.
 * @param widthZ - On Z.
 * @param maxWidthDepth - Max horizontal span (same limit on X and Z in v1 safety).
 * @param maxHeight - Max vertical span.
 */
export function safetyRegionTooLargeMessage(
  widthX: number,
  widthY: number,
  widthZ: number,
  maxWidthDepth: number,
  maxHeight: number,
): string {
  return (
    `Safety: that build's bounding box is ${widthX}×${widthY}×${widthZ} blocks, ` +
    `but I allow at most ${maxWidthDepth} wide/deep and ${maxHeight} tall per request. ` +
    `Ask for a smaller footprint, lower height, or split into several steps.`
  );
}

/**
 * @param volume - Declared region volume.
 * @param limit - Max blocks per request.
 */
export function safetyVolumeExceededMessage(volume: number, limit: number): string {
  return (
    `Safety: the declared build region covers about ${volume} blocks, ` +
    `which is above my limit of ${limit} blocks changed in one request. ` +
    `Shrink the area or build in stages.`
  );
}

/**
 * @param estimated - Estimated layer-map cell count (non–no-op voxels).
 * @param limit - Max blocks per request.
 */
export function safetyLayerMapVolumeExceededMessage(estimated: number, limit: number): string {
  return (
    `Safety: the layer map(s) in that plan would place roughly ${estimated} blocks—` +
    `above my per-request cap of ${limit}. ` +
    `Use a smaller footprint, fewer layers, or split into multiple requests.`
  );
}

/**
 * @param dx - Horizontal distance from player to build centre on X.
 * @param dz - Same on Z.
 * @param limit - Max allowed horizontal Chebyshev or we use separate - actually safety uses separate dx dz > 32
 */
export function safetyTooFarFromPlayerMessage(dx: number, dz: number, limit: number): string {
  return (
    `Safety: the build is centred too far from you horizontally ` +
    `(about ${dx} blocks on X and ${dz} on Z from your feet; I allow up to ${limit} on each axis). ` +
    `Move closer, or ask to build nearer to your position.`
  );
}

/**
 * Semantics: pass order would wipe an earlier build.
 */
export const SEMANTICS_PASS_ORDER =
  "Plan check: a clear/replace-to-air step would completely erase an earlier fill in the same pass order. " +
  "Re-order passes so demolition happens before construction, or narrow the clear region so it doesn't swallow the whole build.";

/**
 * Semantics: structure intent but tiny bbox.
 *
 * @param volume - Bounding box volume.
 * @param minVolume - Minimum required.
 */
export function semanticsDegenerateStructureMessage(volume: number, minVolume: number): string {
  return (
    `Plan check: for that kind of structure the footprint is only ${volume} blocks ` +
    `(I expect at least about ${minVolume} for a real building). ` +
    `Specify width, depth, and height so the model doesn't collapse to a single block.`
  );
}

function truncateForPlayer(text: string, maxChars: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= maxChars) {
    return t.length > 0 ? t : "(empty message)";
  }
  return `${t.slice(0, maxChars - 1)}…`;
}
