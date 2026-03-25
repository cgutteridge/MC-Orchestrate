import type { ChatCommandRequest } from "../../types/plugin.js";
import { composeDesignPhaseMaterialRegistrySection } from "../designMaterialContext.js";
import type { Plan } from "../schema.js";
import type { StepChatPrompt } from "./stepPromptTypes.js";

function designReplyContract(): string {
  return "Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.";
}

function designChoiceSchemaGuide(): string {
  return `Return DESIGN_CHOICE ${JSON.stringify({
    action: "design_choice",
    designSummary: "one-line aesthetic / structure description",
    builderGuide: "prose instructions for the layer-map / voxel-grid step (step 3)",
    desiredSize: { width: "INTEGER", depth: "INTEGER", height: "INTEGER" },
    verticalReference: "on_ground|under_ground|flying",
    recommendedMaterials: ["LIST"],
  })}.`;
}

function designScaleAndVerticalReference(): string {
  return `Scale: 1 voxel = 1 m³.

verticalReference options:
  on_ground = normal buildings sitting on ground (anchor at base; structure goes up)
  under_ground = excavations like trenches/pools (anchor at ground level; structure goes down)
  flying = floating structures in mid-air (anchor at center; not tied to ground)

${composeDesignPhaseMaterialRegistrySection()}`;
}

/**
 * **Step 2 — design:** full system prompt (materials + footprint + builder guide schema).
 *
 * @returns Concatenated system message for the design phase.
 */
export function getDesignStepSystemPrompt(): string {
  return [
    designReplyContract(),
    "",
    designChoiceSchemaGuide(),
    "",
    designScaleAndVerticalReference(),
  ].join("\n");
}

/**
 * **Step 2 — design:** user message (raw player chat line).
 *
 * @param request Current plugin request.
 */
export function getDesignStepUserMessage(request: ChatCommandRequest): string {
  return request.message;
}

/**
 * **Step 2 — design:** system + user prompts together.
 *
 * @param request Current plugin request.
 * @param _lastPlan Reserved for follow-up symmetry; does not change the user string today.
 * @returns Messages content for one design-phase model call.
 */
export function composeDesignStepPrompt(
  request: ChatCommandRequest,
  _lastPlan?: Plan,
): StepChatPrompt {
  return {
    system: getDesignStepSystemPrompt(),
    user: getDesignStepUserMessage(request),
  };
}
