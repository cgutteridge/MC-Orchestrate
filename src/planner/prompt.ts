import type { ChatMessage } from "../services/ai/types.js";
import type { ChatCommandRequest } from "../types/plugin.js";
import type { Plan, Region } from "./schema.js";
import type { BlockSample } from "../types/plugin.js";

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
  "Set verifyRegion to a box 2 blocks larger than your build on all sides so you can see the full context.",
  "",
  "=== ANCHORING ===",
  "",
  "Anchor to targetBlock (the block the player is looking at) when available — build on TOP of or adjacent to it.",
  "If no targetBlock, anchor horizontally in front of the player based on the lookVector.",
  "Avoid placing blocks on or through the player's body (y = player.position.y and y+1).",
  "Do not trust steep pitch angles (pitch > 60 degrees) for placement direction.",
  "",
  "=== CONTEXT AWARENESS ===",
  "",
  "recentMessages contains the player's last bot prompts in chronological order.",
  "Use them to understand follow-up requests (taller, bigger, different material, etc.).",
  "lastBuiltStructure is the plan from the last successful build — use it for follow-up context.",
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
 */
export function buildInitialMessages(request: ChatCommandRequest, lastPlan?: Plan): ChatMessage[] {
  const parts: string[] = [
    "Design a Minecraft build for this player request.",
  ];

  const nearbySummary = buildNearbyContextSummary(request);
  if (nearbySummary) {
    parts.push(nearbySummary);
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
      lastBuiltStructure: lastPlan ?? null,
    },
    null,
    2,
  ));

  return [
    { role: "system", content: SYSTEM_PROMPT },
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
 * @param blocks The scanned BlockSamples, or undefined if the scan failed.
 */
export function appendViewRequestFulfillment(
  messages: ChatMessage[],
  assistantJson: string,
  selfNotes: string,
  region: Region,
  blocks: BlockSample[] | undefined,
): void {
  messages.push({ role: "assistant", content: assistantJson });

  const scanResult =
    blocks && blocks.length > 0
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
