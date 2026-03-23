import type { ChatMessage } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { Plan, Placement, Region } from "./schema.js";
import type { BlockSample } from "../types/plugin.js";
import { computePlanCenter, resolvePlacement } from "./placement.js";
import { collectPromptHints, formatPromptHintsSection } from "./promptHints.js";

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
 * Formats prior player lines for the user prompt when `recentMessages` is non-empty.
 */
function formatConversationHistoryForPrompt(request: ChatCommandRequest): string | undefined {
  const { recentMessages } = request;
  if (recentMessages.length === 0) {
    return undefined;
  }
  const lines = recentMessages.map((line, i) => `${i + 1}. ${line}`);
  return [
    'CONVERSATION HISTORY (oldest first; excludes this turn\'s JSON field "message" — that is the latest line only):',
    ...lines,
  ].join("\n");
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
  const { position, lookVector } = request.player;
  const px = Math.round(position.x);
  const py = Math.round(position.y);
  const pz = Math.round(position.z);

  // Horizontal projection of look vector — ignoring pitch so steep angles
  // don't collapse the in-front direction toward (0,0).
  const hx = lookVector.x;
  const hz = lookVector.z;
  const hLen = Math.sqrt(hx * hx + hz * hz);
  const nhx = hLen > 0.01 ? hx / hLen : 0;
  const nhz = hLen > 0.01 ? hz / hLen : 1;

  const front = (d: number) => `(${Math.round(px + nhx * d)}, ${py}, ${Math.round(pz + nhz * d)})`;
  // Left = 90° counterclockwise turn in XZ from the player's perspective:
  // rotate (nhx, nhz) left → (nhz, -nhx)
  const left = (d: number) => `(${Math.round(px + nhz * d)}, ${py}, ${Math.round(pz - nhx * d)})`;
  // Right = 90° clockwise turn: rotate (nhx, nhz) right → (-nhz, nhx)
  const right = (d: number) => `(${Math.round(px - nhz * d)}, ${py}, ${Math.round(pz + nhx * d)})`;

  return [
    "PLACEMENT REFERENCE — use these pre-computed coordinates as your anchor origin.",
    `  Player feet:         x=${px} y=${py} z=${pz}  ← never build on the player's body blocks (y=${py} and y=${py + 1})`,
    `  Player head (code up:0 for player_view / player_absolute): y=${py + 1}`,
    `  5 blocks in front:  ${front(5)}`,
    `  10 blocks in front: ${front(10)}`,
    `  20 blocks in front: ${front(20)}`,
    `  5 blocks behind:    (${Math.round(px - nhx * 5)}, ${py}, ${Math.round(pz - nhz * 5)})`,
    `  5 blocks left:      ${left(5)}`,
    `  5 blocks right:     ${right(5)}`,
    "  Cardinal offsets from player (scale D as needed):",
    `    north (−z): x=${px} z=${pz}-D`,
    `    south (+z): x=${px} z=${pz}+D`,
    `    east  (+x): x=${px}+D z=${pz}`,
    `    west  (−x): x=${px}-D z=${pz}`,
    `  5 blocks above head:  y=${py + 1 + 5}`,
    `  10 blocks above head: y=${py + 1 + 10}`,
    `  5 blocks below head:  y=${py + 1 - 5}`,
    "  Scale vertically as needed. 'above me' with no distance → placement up≈10 (ten blocks above head).",
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
 * Minimal user message for step 2 (build): build volume, vertical anchor,
 * optional ground hint (only when {@link hasSolidGroundBelowResolvedAnchor}),
 * and the player’s wording — no coordinates or full plugin JSON.
 *
 * @param request Original chat request (message, recentMessages).
 * @param placement Locked placement from step 1 (must include `desiredSize`).
 * @param lastPlan Optional prior plan for `last_build` resolution.
 * @param selfNotes Optional notes from placement_choice.
 */
export function buildPlanPhaseUserContent(
  request: ChatCommandRequest,
  placement: Placement,
  lastPlan: Plan | undefined,
  selfNotes?: string,
): string {
  const lastCenter = lastPlan !== undefined ? computePlanCenter(lastPlan) : undefined;
  const anchor = resolvePlacement(placement, request, lastCenter);
  const showGround = hasSolidGroundBelowResolvedAnchor(request, anchor);

  const ds = placement.desiredSize;
  if (ds === undefined) {
    throw new Error("buildPlanPhaseUserContent requires placement.desiredSize");
  }

  const lines: string[] = [
    "Fill this volume with your layer map (local coordinates; the server places it in the world).",
    "",
    `Volume: ${ds.width} wide × ${ds.depth} deep × ${ds.height} tall (cells).`,
    `Vertical anchor on that box: ${placement.verticalReference} — top = top face / rim; bottom = bottom face on terrain; middle / flying = vertical centre (flying = same math as middle; use for builds in open air — plan step will use this later).`,
  ];
  if (showGround) {
    lines.push(
      "Terrain: sampled blocks show solid ground below this footprint — design resting on or tied to ground, not floating in empty sky.",
    );
  }
  lines.push("", `Build request: ${request.message}`);
  if (request.recentMessages.length > 0) {
    const tail = request.recentMessages.slice(-5);
    lines.push(`Earlier lines: ${tail.join(" → ")}`);
  }
  if (selfNotes?.trim()) {
    lines.push(`Notes from placement step: ${selfNotes.trim()}`);
  }
  return lines.join("\n");
}

/**
 * Replaces the placement-then-build message history with plan-phase system + minimal user only
 * (no coordinates, no full placement JSON, no initial-scan dump).
 *
 * @param messages Mutable message list (cleared and repopulated).
 * @param request Chat request for hints and user text.
 * @param placement Locked placement from step 1.
 * @param lastPlan Optional last successful plan (for last_build anchor resolution).
 * @param selfNotes Optional placement_choice selfNotes.
 */
export function resetMessagesForPlanPhase(
  messages: ChatMessage[],
  request: ChatCommandRequest,
  placement: Placement,
  lastPlan: Plan | undefined,
  selfNotes?: string,
): void {
  messages.length = 0;
  messages.push(
    { role: "system", content: buildPlanPhaseSystemContent(request) },
    {
      role: "user",
      content: buildPlanPhaseUserContent(request, placement, lastPlan, selfNotes),
    },
  );
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
      primitives: [],
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

/** Example shape for phase 1 — must match {@link PlacementChoiceStepSchema} (flat `action`, object `placement`). */
const PLACEMENT_CHOICE_GUIDE = {
  action: "placement_choice",
  placement: {
    ref: "player_view | player_absolute | focus | last_build",
    forward: 8,
    up: 0,
    desiredSize: { width: 16, depth: 16, height: 12 },
    verticalReference: "top | middle | bottom | flying",
  },
  selfNotes: "optional — echoed next turn",
};

// ---------------------------------------------------------------------------
// System prompts — step 1: placement only; step 2: layer map / plan
// ---------------------------------------------------------------------------

const JSON_DISCIPLINE = [
  "Reply with exactly one JSON object per turn. No markdown fences; no prose outside JSON.",
].join("\n");

/** Placement rules — step 1 (`placement_choice`) and step 2 (`build` carries merged placement). */
const PLACEMENT_RULES_COMPACT = [
  "PLACEMENT (user message includes a PLACEMENT REFERENCE card with anchor coords).",
  "On step 2, `targetRegion.min` is the SW-bottom of your layer map after the server applies placement from step 1.",
  "ref: player_view (forward/back/left/right) | player_absolute (north/south/east/west) | focus (NSEW or 0 = here) | last_build (follow-ups).",
  "Y baseline: player_view/player_absolute → up:0 = head (feet Y + 1); focus → up:0 = top of looked-at block +1; last_build → prior centre Y.",
  "Step 1 requires placement.desiredSize {width,depth,height} and verticalReference: top | middle | bottom | flying (anchor on the box: top=surface/in-ground, bottom=on ground, middle=floating/spans, flying=same anchor as middle — reserve for aerial/open-sky builds; plan step will use flying for richer instructions later).",
  "Default if vague: {ref:player_view, forward:8}. Never intersect the player's body blocks.",
  "Phrase hints: 'in front of me' → forward; 'to my left' → left; 'above me' → up; '10 blocks NE' → player_absolute north+east; 'here' → focus; 'make it bigger' → last_build; 'a pit under me' → down.",
].join("\n");

const CONVERSATION_FOLLOWUPS_COMPACT = [
  "=== CONVERSATION AND FOLLOW-UPS ===",
  "User JSON has message, recentMessages, lastBuiltStructureSummary, lastBuiltStructure. Treat as one thread; short messages refer to prior lines or LAST BUILD SUMMARY.",
  "Follow-ups (taller, oak, move it): use placement ref last_build when editing the previous build.",
  "Use nearbyBlocks + initialScanRegion as your primary context for terrain and materials; you cannot request additional world scans.",
].join("\n");

const LAYER_MAP_AND_PLAN_COMPACT = [
  "BUILDS USE LAYER MAPS ONLY: each pass has layerMap + primitives:[]. No fill_cuboid / cylinder / set_block / etc.",
  "layers[] = Y slices top→bottom; within a slice, rows = +Z, chars = +X. palette maps char → minecraft:id. ` ` = leave block; `_` = air.",
  "Max 32×32 footprint, 48 tall. Prefer one full-structure pass; second pass only for polish. Straight silhouettes unless the player asked for round.",
  "Real 3D needs many slices — one slice = a flat slab. verifyRegion: optional box ~2 blocks past the build for inspection.",
].join("\n");

const MATERIALS_AND_CONSTRAINTS_COMPACT = [
  "=== MATERIALS ===",
  "Put vanilla `minecraft:` block ids in palettes and primitives. Unknown or non-vanilla ids are replaced with minecraft:stone at execution (the player is warned).",
  "=== CONSTRAINTS ===",
  "Stay in-world; stay within ~32 blocks of the player unless asked otherwise. Every plan must include at least one executable pass; do not invent world coords.",
].join("\n");

/**
 * Step 1 — placement and size only (no layer-map instructions).
 */
const PLACEMENT_PHASE_SYSTEM_PROMPT = [
  JSON_DISCIPLINE,
  "",
  "Step 1 of 2: placement and size only. Do not output a Plan, layerMap, or passes.",
  "",
  `Return PLACEMENT_CHOICE ${JSON.stringify(PLACEMENT_CHOICE_GUIDE)} — required: placement.desiredSize, placement.verticalReference, ref, offsets.`,
  "",
  PLACEMENT_RULES_COMPACT,
  "",
  CONVERSATION_FOLLOWUPS_COMPACT,
].join("\n");

/**
 * Step 2 — layer map / plan; placement comes from the user message.
 */
const PLAN_PHASE_SYSTEM_PROMPT = [
  JSON_DISCIPLINE,
  "",
  "Step 2 of 2: output the build plan only. The user message gives the build volume and request only — do not send placement or placement_choice.",
  "",
  `Return build ${JSON.stringify(DESIGN_STEP_GUIDE.build)}.`,
  "Layer map must match the given width×depth×height; align content in local Y using the given vertical anchor.",
  "",
  LAYER_MAP_AND_PLAN_COMPACT,
  "",
  "=== PLAN SCHEMA ===",
  JSON.stringify(PLAN_SCHEMA_GUIDE, null, 2),
  "",
  MATERIALS_AND_CONSTRAINTS_COMPACT,
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
): string {
  const parts: string[] = [introLine, buildPlacementCard(request)];

  const nearbySummary = buildNearbyContextSummary(request);
  if (nearbySummary) {
    parts.push(nearbySummary);
  }

  const historyBlock = formatConversationHistoryForPrompt(request);
  if (historyBlock) {
    parts.push(historyBlock);
  }

  const lastSummary = lastPlan ? summarizeLastBuiltPlan(lastPlan) : null;

  if (lastSummary) {
    parts.push(
      `LAST BUILD SUMMARY (use for follow-ups; placement ref last_build anchors to this structure):\n${lastSummary}`,
    );
  }

  parts.push(
    JSON.stringify(
      {
        requestId: request.requestId,
        player: request.player,
        message: request.message,
        recentMessages: request.recentMessages,
        localContext: request.localContext,
        serverContext: request.serverContext,
        initialScanRegion: request.initialScanRegion,
        lastBuiltStructureSummary: lastSummary,
        lastBuiltStructure: lastPlan ?? null,
      },
      null,
      2,
    ),
  );

  return parts.join("\n\n");
}

/**
 * Builds the system message for step 1 — placement only (get location and size).
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
 * Builds the system message for step 2 — layer map / plan (build the thing).
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
 * Builds first-turn messages for the placement phase (step 1 of 2: location only).
 *
 * @param request Current plugin request.
 * @param lastPlan Optional prior successful plan for follow-ups.
 */
export function buildPlacementPhaseMessages(
  request: ChatCommandRequest,
  lastPlan?: Plan,
): ChatMessage[] {
  if (isMinimalInitialPromptEnabled()) {
    return buildMinimalPlacementMessages(request, lastPlan);
  }

  const userContent = buildSharedUserContent(
    request,
    lastPlan,
    "Choose placement, size, and vertical reference for this request (step 1 of 2). No layer map yet.",
  );
  const systemContent = buildPlacementPhaseSystemContent(request);
  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

/**
 * When `MCORCH_MINIMAL_INITIAL_PROMPT` is `true`/`1`/`yes`, {@link buildPlacementPhaseMessages}
 * uses a drastically shortened placement-only prompt for debugging token count and latency.
 * Output quality is not expected to match production; unset for real runs.
 *
 * @returns True when minimal prompt mode is enabled.
 */
export function isMinimalInitialPromptEnabled(): boolean {
  const v = process.env.MCORCH_MINIMAL_INITIAL_PROMPT?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Stripped-down step 1 messages (experimental). Omits placement card, hint blocks,
 * conversation history formatting, and pretty-printed request JSON.
 */
function buildMinimalPlacementMessages(
  request: ChatCommandRequest,
  lastPlan?: Plan,
): ChatMessage[] {
  const guide = JSON.stringify(PLACEMENT_CHOICE_GUIDE);
  const systemContent = [
    "Minecraft builder step 1/2. Reply with exactly one JSON object. No markdown fences or prose outside JSON.",
    `Return only placement_choice: ${guide}`,
    "No plan, layerMap, or passes on this turn.",
  ].join("\n");

  const userParts: string[] = [`Request: ${request.message}`];
  if (lastPlan !== undefined) {
    userParts.push(`Prior build: ${summarizeLastBuiltPlan(lastPlan)}`);
  }
  userParts.push(
    `Context: ${JSON.stringify({
      requestId: request.requestId,
      world: request.player.world,
      position: request.player.position,
      message: request.message,
      recentMessages: request.recentMessages,
      nearbyBlocks: request.localContext.nearbyBlocks.slice(0, 24),
      initialScanRegion: request.initialScanRegion,
    })}`,
  );

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
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
