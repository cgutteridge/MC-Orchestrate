import type { ChatCommandRequest } from "../../types/plugin.js";
import type { Plan } from "../schema.js";
import type { StepChatPrompt } from "./stepPromptTypes.js";

/**
 * Opening constraint: single JSON object, no markdown or extra prose.
 */
function placementReplyContract(): string {
  return "Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.";
}

/**
 * Placement task: infer anchor intent and emit the example offset shape.
 */
function placementTaskAndExampleShape(): string {
  return `Infer placement intent from player text and nearby context.

Return this JSON shape with literal enum values (choose one): ${JSON.stringify({
    ref: "player",
    frame: "player",
    offset: {
      F: 10,
      R: 0,
      N: 0,
      E: 0,
      UP: 0,
    },
  })}.`;
}

/**
 * Field semantics, defaults, scale vocabulary, and phrase→field hints.
 */
function placementFieldRules(): string {
  return `Return placement intent only as {ref, frame, offset}. No action, no size, no plan, no materials, no layerMap.
ref: player | focus.
frame selects horizontal axes: player => F,R; world => N,E. Always include UP.
Signed axis meanings: +F forward, -F back, +R right, -R left, +N north, -N south, +E east, -E west, +UP up, -UP down.
Always return all keys: offset {F,R,N,E,UP} as integers. If frame=player set N=0,E=0. If frame=world set F=0,R=0.
Default when vague: {ref:'player', frame:'player', offset:{F:10,R:0,N:0,E:0,UP:0}}.
Scale words: close 3-10, default 10-20, far/long way 20-50, very long way 50+.
'Up in the sky' means UP >= 20.
Phrase hints: 'in front of me' => frame:player with +F; 'to my left' => frame:player with -R; '10 blocks NE' => frame:world with +N and +E; 'here' or 'on this block' => ref:focus.`;
}

/**
 * **Step 1 — placement:** full system prompt (anchor JSON only).
 *
 * @returns Concatenated system message for the placement phase.
 */
export function getPlacementStepSystemPrompt(): string {
  return [
    placementReplyContract(),
    "",
    placementTaskAndExampleShape(),
    "",
    placementFieldRules(),
  ].join("\n");
}

/**
 * **Step 1 — placement:** user message (raw player chat line).
 *
 * @param request Current plugin request.
 */
export function getPlacementStepUserMessage(request: ChatCommandRequest): string {
  return request.message;
}

/**
 * **Step 1 — placement:** system + user prompts together.
 *
 * @param request Current plugin request.
 * @param _lastPlan Reserved for follow-up symmetry; does not change the user string today.
 * @returns Messages content for one placement-phase model call.
 */
export function composePlacementStepPrompt(
  request: ChatCommandRequest,
  _lastPlan?: Plan,
): StepChatPrompt {
  return {
    system: getPlacementStepSystemPrompt(),
    user: getPlacementStepUserMessage(request),
  };
}
