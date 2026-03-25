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
