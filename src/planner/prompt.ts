import type { ChatMessage } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { Plan, Region } from "./schema.js";
import type { BlockSample } from "../types/plugin.js";
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
    "CONVERSATION HISTORY (oldest first; excludes this turn's JSON field \"message\" — that is the latest line only):",
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
  const left  = (d: number) => `(${Math.round(px + nhz * d)}, ${py}, ${Math.round(pz - nhx * d)})`;
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
      primitives: [
        { type: "set_block", x: 0, y: 0, z: 0, block: "minecraft:stone" },
        { type: "fill_cuboid", from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, block: "minecraft:stone" },
        { type: "hollow_cuboid", from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, block: "minecraft:stone" },
        { type: "clear_region", from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 } },
        { type: "replace_in_region", from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, fromBlock: "minecraft:oak_log", toBlock: "minecraft:air" },
        { type: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 3, height: 5, block: "minecraft:stone", hollow: false, axis: "y" },
      ],
    },
  ],
  reply: "short player-facing confirmation text",
  needsMoreInfo: false,
  clarification: "optional string — only when needsMoreInfo is true",
};

const DESIGN_STEP_GUIDE = {
  view_request: {
    action: "view_request",
    region: { world: "string", min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } },
    selfNotes: "Your private reasoning and intentions for the next turn. Be specific about what you are looking for and what you plan to build.",
  },
  build: {
    action: "build",
    plan: "<<Plan object as above>>",
    verifyRegion: "optional Region — when present the server reads that area after building and shows you the result so you can issue a polish pass",
  },
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You are an expert Minecraft building designer with full creative control.",
  "The player has sent you a build request via in-game chat.",
  "You work in a multi-turn loop: each turn you return exactly one JSON object.",
  "Do NOT use markdown fences. Do NOT explain your reasoning outside the JSON.",
  "",
  "=== YOUR TWO POSSIBLE RESPONSE TYPES ===",
  "",
  "1. VIEW_REQUEST — use this when you need to see more of the world before deciding what to build.",
  `   Schema: ${JSON.stringify(DESIGN_STEP_GUIDE.view_request)}`,
  "   The server will scan that region and return the block data on your next turn.",
  "   Use selfNotes to record what you are looking for and what you plan to do next.",
  "   Keep requested regions within a 64×64×64 volume to avoid timeouts.",
  "",
  "2. BUILD — use this when you are ready to execute a design.",
  `   Schema: ${JSON.stringify(DESIGN_STEP_GUIDE.build)}`,
  "   The plan field must be a valid Plan object (see PLAN SCHEMA below).",
  "   Include verifyRegion when you want to inspect the result and possibly polish it.",
  "   After you set verifyRegion, the server will show you what was placed and you get one more turn to refine.",
  "",
  "=== DESIGN PHILOSOPHY ===",
  "",
  "YOU own all design decisions. The server never interprets the player's words — only you do.",
  "Design structures that are interesting, proportioned, and contextually appropriate.",
  "Use the player's position, look vector, and target block to decide WHERE to build.",
  "Use nearby block data to pick materials that fit the environment.",
  "Think in terms of passes: foundation → walls → roof → detail → trim.",
  "Use hollow_cuboid for walls, cylinder for towers or round structures, fill_cuboid for floors and roofs.",
  "LAYER MAP (optional alternative to primitives): a pass may use `layerMap` instead of `primitives`. `layers` is a JSON array of strings — each string is ONE horizontal slice, ordered TOP to BOTTOM (first element = highest Y, last = lowest Y). Within each slice, use newlines between rows; each row is characters left-to-right = +X, rows top-to-bottom = +Z. After the layers, `palette` maps each single-character key to a full `minecraft:` block id. Use a space character for air (or map \" \" in palette). All rows in a slice must have the same width; all slices must share the same footprint. Max footprint 32×32 per slice, max 48 slices tall. At most ONE layer-map pass per plan (combine slices into one `layers` array). Good for castles, trenches, and anything that reads better as a 2D pattern per height level.",
  "Set verifyRegion to a box 2 blocks larger than your build on all sides so you can see the full context.",
  "",
  "=== PLACEMENT AND OFFSETS ===",
  "",
  "The user message contains a PLACEMENT REFERENCE card with pre-computed anchor coordinates. Use those values directly in your primitive coordinates.",
  "",
  "Every build response MUST include a placement field. Choose the correct ref and set the relevant offsets:",
  "",
  "placement.ref — strict enum, pick exactly one:",
  "  player_view     — player position, player-relative offsets (forward/back/left/right)",
  "  player_absolute — player position, compass offsets (north/south/east/west)",
  "  focus           — looked-at block position, compass offsets (or none = 'right here')",
  "  last_build      — last built structure centre, compass offsets (for follow-up builds)",
  "",
  "Horizontal offsets:",
  "  player_view:     forward, back, left, right  (all integers, default 0)",
  "  player_absolute: north, south, east, west    (all integers, default 0)",
  "  focus:           north, south, east, west    (all integers, default 0)",
  "  last_build:      north, south, east, west    (all integers, default 0)",
  "",
  "Y is always independent of horizontal offsets. Vertical zero depends on placement.ref:",
  "  player_view / player_absolute: up:0 = player HEAD height (feet Y + 1). up:N = N blocks above head. down:N = N blocks below that head baseline (pits).",
  "  focus: up:0 = top of looked-at block (block Y + 1). Without a target block, same as head height.",
  "  last_build: up:0 = last structure centre Y (fallback: head height).",
  "  Aerial builds typically need up:2+ so the footprint clears nearby terrain.",
  "",
  "Examples:",
  "  'in front of me'       → placement:{ref:player_view, forward:8}",
  "  'to my left'           → placement:{ref:player_view, left:8}",
  "  '10 blocks NE'         → placement:{ref:player_absolute, north:10, east:10}",
  "  'here / on this block' → placement:{ref:focus}",
  "  'above me'             → placement:{ref:player_view, up:10}",
  "  '10 above that block'  → placement:{ref:focus, up:10}",
  "  'make it bigger'       → placement:{ref:last_build}",
  "  'a pit under me'       → placement:{ref:player_absolute, down:3}",
  "",
  "DEFAULT when no location specified: placement:{ref:player_view, forward:8}.",
  "Never place structures at or on the player's body.",
  "",
  "=== CONVERSATION AND FOLLOW-UPS ===",
  "",
  "The user message is built from several parts; the JSON block at the end includes:",
  "  - message — this turn's chat line only.",
  "  - recentMessages — earlier chat lines from this session, oldest first, excluding `message`.",
  "  - lastBuiltStructureSummary — one-line recap of the last successful build (when present).",
  "  - lastBuiltStructure — full prior plan JSON (optional detail; prefer the summary + follow-up logic).",
  "Treat recentMessages plus message as one running conversation. Resolve vague follow-ups by binding them to earlier lines and/or the last build:",
  "  e.g. taller, wider, use oak, move it, to the left, same thing but, that tower, add windows — use placement ref last_build when modifying the previous structure.",
  "If the current message is very short, assume it refers to the immediately preceding topic in recentMessages or the LAST BUILD SUMMARY section.",
  "",
  "initialScanRegion tells you the bounding box of the block data you already have.",
  "If you need to see outside that box, use view_request.",
  "",
  "=== PLAN SCHEMA ===",
  "",
  `${JSON.stringify(PLAN_SCHEMA_GUIDE, null, 2)}`,
  "",
  "=== MATERIAL SLOTS ===",
  "",
  "Prefer symbolic material slots over free-form block names when the player has not specified a material.",
  "Supported slots: material:wall, material:roof, material:floor, material:trim, material:detail, material:wood, material:stone, material:glass, material:wool.",
  "Only use a concrete block id when the player explicitly named that material (e.g. 'glass tower' → minecraft:glass).",
  "Do not use vague or obsolete ids like minecraft:wood or minecraft:wool.",
  "Do not use non-structural blocks (air, water, lava, grass, leaves) as build materials.",
  "",
  "=== CONSTRAINTS ===",
  "",
  "Keep all coordinates within the player's world and within 32 blocks of the player unless the player asks otherwise.",
  "clear_region does not include a block field.",
  "Cylinder radius: 1–16. Cylinder height: 1–32.",
  "If the request is genuinely ambiguous or unsafe, return a build response with needsMoreInfo=true, passes=[], and a clear clarification.",
  "Do not invent coordinates when asking for clarification.",
].join("\n");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the initial messages array for the first turn of the design loop.
 *
 * The system message is {@link SYSTEM_PROMPT} plus optional contextual paragraphs
 * from {@link collectPromptHints} when the request text (message + recentMessages)
 * matches configured keywords — see `src/planner/promptHints.ts`.
 *
 * @param request Current plugin request (used for placement card, history, and hint matching).
 * @param lastPlan Optional prior successful plan for follow-up turns.
 */
export function buildInitialMessages(request: ChatCommandRequest, lastPlan?: Plan): ChatMessage[] {
  const parts: string[] = [
    "Design a Minecraft build for this player request.",
    buildPlacementCard(request),
  ];

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

  parts.push(JSON.stringify(
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
  ));

  const hintSection = formatPromptHintsSection(collectPromptHints(request));
  const systemContent =
    hintSection !== undefined ? `${SYSTEM_PROMPT}\n\n${hintSection}` : SYSTEM_PROMPT;

  return [
    { role: "system", content: systemContent },
    { role: "user", content: parts.join("\n\n") },
  ];
}

/**
 * Appends a view_request fulfillment pair to an existing message history.
 * The assistant message is the exact JSON the AI returned; the user message
 * contains the block scan result plus the AI's own selfNotes.
 *
 * @param messages Existing message history (mutated in place).
 * @param assistantJson The raw JSON string the AI returned for the view_request.
 * @param selfNotes The selfNotes from the AI's view_request.
 * @param region The region that was scanned.
 * @param blocks The scanned BlockSamples, or undefined when the scan did not
 *   yield usable block data.
 * @param options When `scanUnavailable` is true, `blocks` is ignored and the
 *   user message explains that an on-disk read was not available (do not treat
 *   this as an empty region).
 */
export function appendViewRequestFulfillment(
  messages: ChatMessage[],
  assistantJson: string,
  selfNotes: string,
  region: Region,
  blocks: BlockSample[] | undefined,
  options?: { scanUnavailable?: boolean; reason?: string },
): void {
  messages.push({ role: "assistant", content: assistantJson });

  const scanResult = options?.scanUnavailable
    ? [
        "On-disk world scan is unavailable for this region.",
        options.reason?.trim() ? `Detail: ${options.reason.trim()}` : "",
        "Proceed without assuming you saw blocks outside the initial plugin payload.",
      ]
        .filter(Boolean)
        .join(" ")
    : blocks && blocks.length > 0
      ? `${blocks.length} non-air blocks found:\n${JSON.stringify(blocks)}`
      : "No non-air blocks found in this region (it may be ungenerated or all air).";

  messages.push({
    role: "user",
    content: [
      `World scan result for region min(${region.min.x},${region.min.y},${region.min.z}) to max(${region.max.x},${region.max.y},${region.max.z}):`,
      scanResult,
      "",
      `Your selfNotes were: ${selfNotes}`,
      "",
      "Continue.",
    ].join("\n"),
  });
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
      "If the result looks correct, return a build response with needsMoreInfo=true, passes=[], and reply confirming completion.",
      "If you see issues to fix, return a build response with a targeted polish plan.",
      "Do NOT include verifyRegion this time.",
    ].join("\n"),
  });
}
