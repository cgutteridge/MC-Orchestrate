import type { ChatMessage } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { DesignChoiceStep, Plan, Placement, Region } from "./schema.js";
import type { BlockSample } from "../types/plugin.js";
import { buildDesignPhaseMaterialRegistrySection } from "./designMaterialContext.js";

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
 * @param terrainGroundHint When true, mention solid ground below the footprint.
 */
export function buildPlanPhaseUserContent(
  _request: ChatCommandRequest,
  mergedPlacement: Placement,
  design: DesignChoiceStep,
  terrainGroundHint: boolean,
): string {
  const ds = mergedPlacement.desiredSize;
  if (ds === undefined) {
    throw new Error("buildPlanPhaseUserContent requires placement.desiredSize");
  }

  const lines: string[] = [
    "Fill this volume with your layer map (local coordinates only; the server places it in the world). You do not know world position.",
    "",
    `Volume: ${ds.width} wide × ${ds.depth} deep × ${ds.height} tall (cells).`,
    `Vertical anchor: ${mergedPlacement.verticalReference}`,
    "",
    "DESIGN SUMMARY (from design step):",
    design.designSummary,
    "",
    "BUILDER GUIDE (from design step):",
    design.builderGuide,
    "",
    "Recommended materials (prefer these in palette chars):",
    design.recommendedMaterials.join(", "),
    "",
  ];
  if (terrainGroundHint) {
    lines.push(
      "Terrain: sampled blocks show solid ground below this footprint — design resting on or tied to ground, not floating in empty sky.",
      "",
    );
  }
  return lines.join("\n");
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
  messages.length = 0;
  messages.push(
    { role: "system", content: buildPlanPhaseSystemContent(request) },
    {
      role: "user",
      content: buildPlanPhaseUserContent(request, mergedPlacement, design, terrainGroundHint),
    },
  );
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
  messages.length = 0;
  messages.push(
    { role: "system", content: buildDesignPhaseSystemContent(request) },
    { role: "user", content: buildDesignPhaseUserContent(request, lastPlan) },
  );
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
  return request.message;
}

// ---------------------------------------------------------------------------
// System prompts — step 1: position; step 2: design; step 3: layer map / plan
// Edit each block as one document; JSON examples use ${JSON.stringify(...)}.
// ---------------------------------------------------------------------------

/**
 * Step 1 — placement / anchor only (no size, no materials, no layer map).
 *
 * @param _request Reserved for API symmetry with other phase builders.
 */
export function buildPlacementPhaseSystemContent(_request: ChatCommandRequest): string {
  return `Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.

Infer placement intent from player text and nearby context.

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
  })}.

Return placement intent only as {ref, frame, offset}. No action, no size, no plan, no materials, no layerMap.
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
 * Step 2 — design: materials, prose guide, footprint size (only step with full material context).
 *
 * @param _request Reserved for API symmetry with other phase builders.
 */
export function buildDesignPhaseSystemContent(_request: ChatCommandRequest): string {
  return `Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.

Return DESIGN_CHOICE ${JSON.stringify({
    action: "design_choice",
    designSummary: "one-line aesthetic / structure description",
    builderGuide: "prose instructions for the layer-map builder (step 3)",
    desiredSize: { width: "INTEGER", depth: "INTEGER", height: "INTEGER" },
    verticalReference: "on_ground|under_ground|flying",
    recommendedMaterials: ["LIST"],
  })}.

Scale: 1 voxel = 1 m³.

verticalReference options:
  on_ground = normal buildings sitting on ground (anchor at base; structure goes up)
  under_ground = excavations like trenches/pools (anchor at ground level; structure goes down)
  flying = floating builds in air (anchor at center; not tied to ground)

${buildDesignPhaseMaterialRegistrySection()}`;
}

/**
 * Step 3 — layer map / plan; volume and materials come from the user message (design + merged placement).
 *
 * @param _request Reserved for API symmetry with other phase builders.
 */
export function buildPlanPhaseSystemContent(_request: ChatCommandRequest): string {
  const cottageLayerMap = {
    layers: [
      ["PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP"].join("\n"),
      ["CCC_CCC", "C_____C", "C_____C", "C_____C", "C_____C", "CCCCCCC"].join("\n"),
      ["CCC_CCC", "C_____C", "G_____G", "G_____G", "C_____C", "CCGGGCC"].join("\n"),
      ["CCCCCCC", "C_____C", "G_____G", "G_____G", "C_____C", "CCGGGCC"].join("\n"),
      ["CCCCCCC", "C_____C", "C_____C", "C_____C", "C_____C", "CCCCCCC"].join("\n"),
      ["PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP", "PPPPPPP"].join("\n"),
      ["       ", " PPPPP ", " PPPPP ", " PPPPP ", " PPPPP ", "       "].join("\n"),
      ["       ", "       ", "  PPP  ", "  PPP  ", "       ", "       "].join("\n"),
    ],
    palette: {
      P: "minecraft:oak_planks",
      C: "minecraft:cobblestone",
      G: "minecraft:glass",
      _: "minecraft:air",
    },
  };

  const minimalLayerMapExample = {
    layers: ["SSS\nSSS\nSSS", "SSS\nS_S\nSSS", "SSS\nSSS\nSSS"],
    palette: { S: "minecraft:stone", _: "minecraft:air" },
  };

  return `Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.

Step 3 of 3 — layer map: placement and design are locked. Return only the voxel grid below — no action field, no passes array, no world coordinates.

You are an expert Minecraft builder. Think in 3D first, then output JSON. The layer map serializes the model you already decided.

Fill the given width×depth×height volume. \`layers\`: bottom→top Y (first string = lowest Y). Within each string, rows = +Z, characters = +X. \`palette\`: one character → one \`minecraft:\` id. Space = leave unchanged; \`_\` = air. Max footprint 32×32, height 48.

Your only output is \`layers\` (array of newline-separated slice strings) and \`palette\` (character → block id). The server turns that into the executable plan.

=== MINIMAL RESPONSE (only these two keys) ===
${JSON.stringify(minimalLayerMapExample, null, 2)}

=== WORKED EXAMPLE (layer map → cottage-shaped build) ===
Illustrative only — adapt to the design step. 7×6 footprint, 7 Y slices. Rows = +Z, chars = +X.
Palette: P=oak_planks, C=cobblestone, G=glass, _=air. space=leave cell unchanged.

${JSON.stringify(cottageLayerMap, null, 2)}

Use vanilla \`minecraft:\` ids in palettes; prefer the design step's recommendedMaterials. Unknown ids may become minecraft:stone at execution.
Filled voxels must match the given width×depth×height. Do not invent world coordinates.`;
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
  const userContent = buildSharedUserContent(
    request,
    lastPlan,
    "Choose placement intent for this request. Return only ref/frame/offset JSON.",
  );
  const systemContent = buildPlacementPhaseSystemContent(request);
  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

/**
 * Builds the shared user prompt body for placement-phase turns (currently the raw
 * player message only).
 *
 * @param request Current plugin request.
 * @param _lastPlan Reserved for follow-up context if placement prompts gain history later.
 * @param _introLine Reserved for richer placement user text if reintroduced.
 * @param _options Reserved for optional sections (e.g. nearby materials).
 */
function buildSharedUserContent(
  request: ChatCommandRequest,
  _lastPlan: Plan | undefined,
  _introLine: string,
  _options?: { includeNearbyMaterials?: boolean },
): string {
  return request.message;
}

/**
 * Appends a post-build verification pair to an existing message history.
 * The assistant message is the exact JSON the AI returned for the build step;
 * the user message contains the placed block data so the AI can decide whether
 * to issue a polish pass.
 *
 * @param messages Existing message history (mutated in place).
 * @param assistantJson The raw JSON string the AI returned for the build step.
 * @param region The verification region that was read.
 * @param blocks The blocks in the verification region.
 */
export function appendVerifyFulfillment(
  messages: ChatMessage[],
  assistantJson: string,
  region: Region,
  blocks: BlockSample[],
): void {
  messages.push({ role: "assistant", content: assistantJson });

  messages.push({
    role: "user",
    content: [
      `Build complete. Verification scan for region min(${region.min.x},${region.min.y},${region.min.z}) to max(${region.max.x},${region.max.y},${region.max.z}):`,
      `${blocks.length} non-air blocks found:\n${JSON.stringify(blocks)}`,
      "",
      "If the result looks correct, return a minimal polish pass or a short reply-only build if nothing should change.",
      "If you see issues to fix, return a build response with a targeted polish plan.",
    ].join("\n"),
  });
}
