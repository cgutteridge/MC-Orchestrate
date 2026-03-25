import type { ChatMessage } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { DesignChoiceStep, Plan, Placement } from "./schema.js";
import {
  buildDesignStepPrompt,
  getDesignStepSystemPrompt,
  getDesignStepUserMessage,
} from "./steps/designStepPrompt.js";
import {
  buildPlanBuildStepPrompt,
  getPlanBuildStepSystemPrompt,
  getPlanBuildStepUserContent,
} from "./steps/planBuildStepPrompt.js";
import {
  buildPlacementStepPrompt,
  getPlacementStepSystemPrompt,
} from "./steps/placementStepPrompt.js";
import type { StepChatPrompt } from "./steps/stepPromptTypes.js";

export type { StepChatPrompt };

/** Re-export step prompt builders so each step’s layout lives under `steps/*`. */
export { buildDesignStepPrompt, buildPlacementStepPrompt, buildPlanBuildStepPrompt };

/**
 * Summarizes the last executed plan as a single readable line for prompts and
 * follow-up context so the model does not have to infer intent from raw JSON.
 *
 * @param plan The validated plan from the previous successful build.
 * @returns A compact line describing intent, footprint, and pass goals.
 */
export function summarizeLastBuiltPlan(plan: Plan): string {
  const { min, max } = plan.targetRegion;
  const dx = max.x - min.x + 1;
  const dy = max.y - min.y + 1;
  const dz = max.z - min.z + 1;
  const passTitles = plan.passes.map((p) => p.name).join(", ");
  const goalPreview = plan.passes
    .slice(0, 2)
    .map((p) => {
      const g = p.goal.trim();
      const short = g.length > 100 ? `${g.slice(0, 100)}…` : g;
      return `${p.name}: ${short}`;
    })
    .join(" | ");

  const parts: string[] = [
    `intent=${plan.intent}`,
    `world=${plan.targetWorld}`,
    `target box min(${min.x},${min.y},${min.z}) max(${max.x},${max.y},${max.z}) size=${dx}×${dy}×${dz}`,
  ];
  const brief = plan.briefFulfilment.trim();
  if (brief.length > 0) {
    const short = brief.length > 160 ? `${brief.slice(0, 160)}…` : brief;
    parts.push(`brief=${short}`);
  }
  if (plan.passes.length > 0) {
    parts.push(`passes=[${passTitles}]`);
    if (goalPreview) {
      parts.push(`goals: ${goalPreview}`);
    }
  } else {
    parts.push("passes=(none)");
  }
  return parts.join(" — ");
}

/**
 * Summarizes the last plan for the **design** step without world coordinates
 * (footprint size and goals only).
 *
 * @param plan Prior successful plan.
 */
export function summarizeLastBuiltPlanForDesign(plan: Plan): string {
  const { min, max } = plan.targetRegion;
  const dx = max.x - min.x + 1;
  const dy = max.y - min.y + 1;
  const dz = max.z - min.z + 1;
  const passTitles = plan.passes.map((p) => p.name).join(", ");
  const goalPreview = plan.passes
    .slice(0, 2)
    .map((p) => {
      const g = p.goal.trim();
      const short = g.length > 100 ? `${g.slice(0, 100)}…` : g;
      return `${p.name}: ${short}`;
    })
    .join(" | ");

  const parts: string[] = [
    `intent=${plan.intent}`,
    `prior footprint ${dx}×${dy}×${dz} (local size only; no world position)`,
  ];
  if (plan.passes.length > 0) {
    parts.push(`passes=[${passTitles}]`);
    if (goalPreview) {
      parts.push(`goals: ${goalPreview}`);
    }
  }
  return parts.join(" — ");
}

/** Blocks treated as empty for “solid ground below anchor” probing. */
const AIR_OR_FLUID_FOR_GROUND_PROBE = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:water",
  "minecraft:lava",
]);

/**
 * Returns true when the resolved placement anchor sits over solid terrain in
 * the sampled blocks (non-air within a short vertical probe below the anchor).
 * Used to decide whether the plan-phase user message mentions ground at all.
 *
 * When the column is missing from `nearbyBlocks` or is all air in the probe
 * range, returns false (treat as in-air / unknown — no terrain line).
 */
export function hasSolidGroundBelowResolvedAnchor(
  request: ChatCommandRequest,
  anchor: { x: number; y: number; z: number },
): boolean {
  const ax = Math.round(anchor.x);
  const az = Math.round(anchor.z);
  const ay = anchor.y;
  /** Only the few blocks directly under the anchor count — not terrain far below a floating build. */
  const probeBelow = 6;
  const blocks = request.localContext.nearbyBlocks.filter(
    (b) => Math.abs(b.x - ax) <= 1 && Math.abs(b.z - az) <= 1 && b.y < ay && b.y >= ay - probeBelow,
  );
  if (blocks.length === 0) {
    return false;
  }
  for (const b of blocks) {
    const t = b.type.toLowerCase();
    if (!AIR_OR_FLUID_FOR_GROUND_PROBE.has(t)) {
      return true;
    }
  }
  return false;
}

/**
 * User message for the **build** step (layer map): volume from merged placement,
 * design guide from step 2, optional terrain hint — no world coordinates.
 * Player chat text is not repeated here; it is reflected in the design step output.
 *
 * @param _request Reserved for API symmetry with other builders (placement/design include request).
 * @param mergedPlacement Locked placement with `desiredSize` from the design step.
 * @param design Validated design_choice (prose + materials).
 * @param _terrainGroundHint When true, mention solid ground below the footprint.
 */
export function buildPlanPhaseUserContent(
  _request: ChatCommandRequest,
  mergedPlacement: Placement,
  design: DesignChoiceStep,
  _terrainGroundHint: boolean,
): string {
  return getPlanBuildStepUserContent(mergedPlacement, design);
}

/**
 * Replaces message history with the **build** phase (layer map only). No world
 * coordinates in the user message; placement is merged server-side for execution.
 *
 * @param messages Mutable message list (cleared and repopulated).
 * @param request Chat request (e.g. for system prompt symmetry; build user text is volume + design only).
 * @param mergedPlacement Placement from step 1 plus `desiredSize` from step 2.
 * @param design Validated design_choice from step 2.
 * @param terrainGroundHint When true, user text mentions solid ground below the footprint.
 */
export function resetMessagesForPlanPhase(
  messages: ChatMessage[],
  request: ChatCommandRequest,
  mergedPlacement: Placement,
  design: DesignChoiceStep,
  terrainGroundHint: boolean,
): void {
  const { system, user } = buildPlanBuildStepPrompt(
    request,
    mergedPlacement,
    design,
    terrainGroundHint,
  );
  messages.length = 0;
  messages.push({ role: "system", content: system }, { role: "user", content: user });
}

/**
 * Clears and fills messages for the **design** step (materials + size + prose guide).
 * Does not include placement cards or world coordinates.
 *
 * @param messages Mutable message list.
 * @param request Current plugin request.
 * @param lastPlan Optional prior plan for abstract follow-up context.
 */
export function resetMessagesForDesignPhase(
  messages: ChatMessage[],
  request: ChatCommandRequest,
  lastPlan: Plan | undefined,
): void {
  const { system, user } = buildDesignStepPrompt(request, lastPlan);
  messages.length = 0;
  messages.push({ role: "system", content: system }, { role: "user", content: user });
}

/**
 * User text for the design phase (no placement card, no coordinates).
 *
 * @param request Current plugin request.
 * @param _lastPlan Reserved for follow-up context if design prompts gain history later.
 */
export function buildDesignPhaseUserContent(
  request: ChatCommandRequest,
  _lastPlan: Plan | undefined,
): string {
  return getDesignStepUserMessage(request);
}

/**
 * Step 1 — placement / anchor only (no size, no materials, no layer map).
 *
 * @param _request Reserved for API symmetry with other phase builders.
 */
export function buildPlacementPhaseSystemContent(_request: ChatCommandRequest): string {
  return getPlacementStepSystemPrompt();
}

/**
 * Step 2 — design: materials, prose guide, footprint size (only step with full material context).
 *
 * @param _request Reserved for API symmetry with other phase builders.
 */
export function buildDesignPhaseSystemContent(_request: ChatCommandRequest): string {
  return getDesignStepSystemPrompt();
}

/**
 * Step 3 — layer map / plan; volume and materials come from the user message (design + merged placement).
 *
 * @param _request Reserved for API symmetry with other phase builders.
 */
export function buildPlanPhaseSystemContent(_request: ChatCommandRequest): string {
  return getPlanBuildStepSystemPrompt();
}

/**
 * Builds first-turn messages for the placement phase (step 1 of 3: position only).
 *
 * @param request Current plugin request.
 * @param lastPlan Optional prior successful plan for follow-ups.
 */
export function buildPlacementPhaseMessages(
  request: ChatCommandRequest,
  lastPlan?: Plan,
): ChatMessage[] {
  const { system, user } = buildPlacementStepPrompt(request, lastPlan);
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
