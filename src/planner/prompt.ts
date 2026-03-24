import type { ChatMessage } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { DesignChoiceStep, Plan, Placement, Region } from "./schema.js";
import type { BlockSample } from "../types/plugin.js";
import { collectPromptHints, formatPromptHintsSection } from "./promptHints.js";
import { buildDesignPhaseMaterialRegistrySection } from "./designMaterialContext.js";

// ---------------------------------------------------------------------------
// Nearby context card
// ---------------------------------------------------------------------------

/**
 * Block types that carry no information about a player's intended build
 * material and should be excluded from the nearby context card.
 */
const CONTEXT_SKIP_BLOCKS = new Set([
  "minecraft:air",
  "minecraft:cave_air",
  "minecraft:void_air",
  "minecraft:water",
  "minecraft:lava",
  "minecraft:grass_block",
  "minecraft:dirt",
  "minecraft:dirt_path",
  "minecraft:oak_leaves",
  "minecraft:birch_leaves",
  "minecraft:spruce_leaves",
  "minecraft:short_grass",
  "minecraft:tall_grass",
]);

/**
 * Builds a compact one-line summary of the most common nearby non-terrain
 * blocks, or `undefined` when no relevant blocks are present.
 */
function buildNearbyContextSummary(request: ChatCommandRequest): string | undefined {
  const counts = new Map<string, number>();
  for (const block of request.localContext.nearbyBlocks) {
    const type = block.type.toLowerCase().trim();
    if (CONTEXT_SKIP_BLOCKS.has(type)) {
      continue;
    }
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return undefined;
  }

  const top = [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([block, count]) => `${block.replace("minecraft:", "")} ×${count}`)
    .join(", ");

  return `Nearby materials: ${top}.`;
}

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

/**
 * Block-type counts near the player for the design phase (no coordinates).
 */
function buildNearbyMaterialsDetailForDesign(request: ChatCommandRequest): string | undefined {
  const counts = new Map<string, number>();
  for (const block of request.localContext.nearbyBlocks) {
    const type = block.type.toLowerCase().trim();
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return undefined;
  }
  const lines = [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([t, c]) => `  ${t} ×${c}`);
  return ["NEARBY BLOCK TYPES (sampled; no coordinates):", ...lines].join("\n");
}


// ---------------------------------------------------------------------------
// Placement card — pre-computed reference points so the AI never has to do
// trig from raw yaw/lookVector values.
// ---------------------------------------------------------------------------

/**
 * Computes a set of concrete anchor coordinates from the player's position and
 * look vector and formats them as a compact placement reference card.
 *
 * The horizontal look direction is derived from lookVector.x/z (ignoring Y so
 * steep pitch angles don't skew the result). All Y values are at player feet
 * unless noted.
 */
function buildPlacementCard(request: ChatCommandRequest): string {
  const { position } = request.player;
  const px = Math.round(position.x);
  const py = Math.round(position.y);
  const pz = Math.round(position.z);

  return [
    `Player at x=${px} y=${py} z=${pz}. Avoid y=${py} and y=${py + 1} (player body).`,
  ].join("\n");
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
 *
 * @param request Original chat request (message, recentMessages).
 * @param mergedPlacement Locked placement with `desiredSize` from the design step.
 * @param design Validated design_choice (prose + materials).
 * @param terrainGroundHint When true, mention solid ground below the footprint.
 */
export function buildPlanPhaseUserContent(
  request: ChatCommandRequest,
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
  lines.push(`Build request: ${request.message}`);
  return lines.join("\n");
}

/**
 * Replaces message history with the **build** phase (layer map only). No world
 * coordinates in the user message; placement is merged server-side for execution.
 *
 * @param messages Mutable message list (cleared and repopulated).
 * @param request Chat request for hints and user text.
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
 * @param lastPlan Optional prior successful plan.
 */
export function buildDesignPhaseUserContent(
  request: ChatCommandRequest,
  lastPlan: Plan | undefined,
): string {
  return request.message;
}

// ---------------------------------------------------------------------------
// Schema guide (embedded in system prompt so AI stays aligned with Zod types)
// ---------------------------------------------------------------------------

const PLAN_SCHEMA_GUIDE = {
  intent: "string (snake_case label, e.g. build_bridge; use unknown when unclear)",
  targetWorld: "string",
  targetRegion: {
    world: "string",
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  },
  assumptions: ["string"],
  passes: [
    {
      name: "string",
      goal: "string",
      layerMap: {
        layers: ["SSS\nSSS\nSSS", "SSS\nS_S\nSSS", "SSS\nSSS\nSSS"],
        palette: {
          S: "minecraft:stone",
        },
      },
    },
  ],
  reply: "short player-facing confirmation text",
};

const DESIGN_STEP_GUIDE = {
  build: {
    action: "build",
    plan: "<<Plan object as above>>",
    verifyRegion: "optional Region — post-build scan for a polish pass",
  },
};

/** Example shape for phase 2 — must match {@link DesignChoiceStepSchema}. */
const DESIGN_CHOICE_GUIDE = {
  action: "design_choice",
  designSummary: "one-line aesthetic / structure description",
  builderGuide: "prose instructions for the layer-map builder (step 3)",
  desiredSize: { width: "INTEGER", depth: "INTEGER", height: "INTEGER" },
  verticalReference: "on_ground|under_ground|flying",
  recommendedMaterials: ["LIST"],
};

/** Example shape for phase 1 — must match {@link PlacementChoiceStepSchema} (flat `action`, object `placement`). */
const PLACEMENT_CHOICE_GUIDE = {
  ref: "player",
  frame: "player",
  offset: {
    F: 10,
    R: 0,
    N: 0,
    E: 0,
    UP: 0,
  },
};

// ---------------------------------------------------------------------------
// System prompts — step 1: position; step 2: design; step 3: layer map / plan
// ---------------------------------------------------------------------------

const JSON_DISCIPLINE = [
  "Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.",
].join("\n");

/** Placement rules — step 1 (`placement_choice`) only; size is chosen in step 2 (design). */
const PLACEMENT_RULES_COMPACT = [
  "Return placement intent only as {ref, frame, offset}. No action, no size, no plan, no materials, no layerMap.",
  "ref: player | focus.",
  "frame selects horizontal axes: player => F,R; world => N,E. Always include UP.",
  "Signed axis meanings: +F forward, -F back, +R right, -R left, +N north, -N south, +E east, -E west, +UP up, -UP down.",
  "Always return all keys: offset {F,R,N,E,UP} as integers. If frame=player set N=0,E=0. If frame=world set F=0,R=0.",
  "Default when vague: {ref:'player', frame:'player', offset:{F:10,R:0,N:0,E:0,UP:0}}.",
  "Scale words: close 3-10, default 10-20, far/long way 20-50, very long way 50+.",
  "'Up in the sky' means UP >= 20.",
  "Phrase hints: 'in front of me' => frame:player with +F; 'to my left' => frame:player with -R; '10 blocks NE' => frame:world with +N and +E; 'here' or 'on this block' => ref:focus.",
].join("\n");


const LAYER_MAP_AND_PLAN_COMPACT = [
  "BUILDS ARE LAYER MAPS ONLY: each pass has `layerMap` (layers + palette). No legacy shape ops.",
  "layers[] = Y slices bottom→top (first layer = ground / lowest Y); within a slice, rows = +Z, chars = +X. palette maps char → minecraft:id. ` ` = leave block; `_` = air.",
  "Max 32×32 footprint, 48 tall. Prefer one full-structure pass; second pass only for polish. Straight silhouettes unless the player asked for round.",
  "Real 3D needs many slices — one slice = a flat slab. verifyRegion: optional box ~2 blocks past the build for inspection.",
].join("\n");

/** Builder step: palette rules only (full material list was design phase). */
const BUILDER_PALETTE_RULES_COMPACT = [
  "=== PALETTE ===",
  "Use vanilla `minecraft:` block ids in palettes. Prefer ids from the design step's recommendedMaterials.",
  "Unknown or non-vanilla ids may be replaced with minecraft:stone at execution (the player is warned).",
  "=== CONSTRAINTS ===",
  "Do not invent world coordinates. Layer map must match the given width×depth×height.",
].join("\n");

/**
 * Step 1 — position / anchor only (no size, no materials, no layer map).
 */
const PLACEMENT_PHASE_SYSTEM_PROMPT = [
  JSON_DISCIPLINE,
  "",
  "Infer placement intent from player text and nearby context.",
  "",
  `Return this JSON shape with literal enum values (choose one): ${JSON.stringify(
    PLACEMENT_CHOICE_GUIDE,
  )}.`,
  "",
  PLACEMENT_RULES_COMPACT,
].join("\n");

/**
 * Step 2 — design: materials, prose guide, footprint size (only step with full material context).
 */
const DESIGN_PHASE_SYSTEM_PROMPT = [
  JSON_DISCIPLINE,
  "",
  `Return DESIGN_CHOICE ${JSON.stringify(DESIGN_CHOICE_GUIDE)}.`,
  "",
  "Scale: 1 voxel = 1 m³.",
  "",
  "verticalReference options:",
  "  on_ground = normal buildings sitting on ground (anchor at base; structure goes up)",
  "  under_ground = excavations like trenches/pools (anchor at ground level; structure goes down)",
  "  flying = floating builds in air (anchor at center; not tied to ground)",
  "",
  buildDesignPhaseMaterialRegistrySection(),
].join("\n");

/**
 * Step 3 — layer map / plan; volume and materials come from the user message (design + merged placement).
 */
const PLAN_PHASE_SYSTEM_PROMPT = [
  JSON_DISCIPLINE,
  "",
  "Step 3 of 3: output the build plan only. The user message gives volume, design guide, and recommended materials — do not send placement or placement_choice.",
  "",
  `Return build ${JSON.stringify(DESIGN_STEP_GUIDE.build)}.`,
  "Layer map must match the given width×depth×height; align content in local Y using the given vertical anchor.",
  "",
  LAYER_MAP_AND_PLAN_COMPACT,
  "",
  "=== PLAN SCHEMA ===",
  JSON.stringify(PLAN_SCHEMA_GUIDE, null, 2),
  "",
  BUILDER_PALETTE_RULES_COMPACT,
].join("\n");

/**
 * Builds the shared user prompt body (placement card, history, JSON payload) for
 * placement-phase turns.
 *
 * @param request Current plugin request.
 * @param lastPlan Optional prior successful plan.
 * @param introLine First paragraph describing this turn's task.
 */
function buildSharedUserContent(
  request: ChatCommandRequest,
  lastPlan: Plan | undefined,
  introLine: string,
  options?: { includeNearbyMaterials?: boolean },
): string {
  return request.message;
}

/**
 * Builds the system message for step 1 — placement only (anchor; no size).
 *
 * @param request Used for optional prompt hints (same keywords as monolithic).
 */
export function buildPlacementPhaseSystemContent(request: ChatCommandRequest): string {
  const hintSection = formatPromptHintsSection(collectPromptHints(request));
  return hintSection !== undefined
    ? `${PLACEMENT_PHASE_SYSTEM_PROMPT}\n\n${hintSection}`
    : PLACEMENT_PHASE_SYSTEM_PROMPT;
}

/**
 * Builds the system message for step 2 — design (materials + size + prose for builder).
 *
 * @param request Used for optional prompt hints (see `promptHints.ts`).
 */
export function buildDesignPhaseSystemContent(request: ChatCommandRequest): string {
  const hintSection = formatPromptHintsSection(collectPromptHints(request));
  return hintSection !== undefined
    ? `${DESIGN_PHASE_SYSTEM_PROMPT}\n\n${hintSection}`
    : DESIGN_PHASE_SYSTEM_PROMPT;
}

/**
 * Builds the system message for step 3 — layer map / plan (build the thing).
 *
 * @param request Used for optional prompt hints (see `promptHints.ts`).
 */
export function buildPlanPhaseSystemContent(request: ChatCommandRequest): string {
  const hintSection = formatPromptHintsSection(collectPromptHints(request));
  return hintSection !== undefined
    ? `${PLAN_PHASE_SYSTEM_PROMPT}\n\n${hintSection}`
    : PLAN_PHASE_SYSTEM_PROMPT;
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
      "Do NOT include verifyRegion this time.",
    ].join("\n"),
  });
}
