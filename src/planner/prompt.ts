import type { ChatCommandRequest } from "../types/plugin.js";

/**
 * Block types that carry no information about a player's intended build
 * material and should be excluded from the nearby context card.
 */
const CONTEXT_SKIP_BLOCKS = new Set([
  "minecraft:air",
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
 * Builds the planner prompt/messages sent to the LLM for structured build planning.
 */
export function buildPlannerMessages(request: ChatCommandRequest) {
  const schemaGuide = {
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
          {
            type: "set_block",
            x: 0,
            y: 0,
            z: 0,
            block: "minecraft:stone",
          },
          {
            type: "fill_cuboid",
            from: { x: 0, y: 0, z: 0 },
            to: { x: 0, y: 0, z: 0 },
            block: "minecraft:stone",
          },
          {
            type: "hollow_cuboid",
            from: { x: 0, y: 0, z: 0 },
            to: { x: 0, y: 0, z: 0 },
            block: "minecraft:stone",
          },
          {
            type: "clear_region",
            from: { x: 0, y: 0, z: 0 },
            to: { x: 0, y: 0, z: 0 },
          },
          {
            type: "replace_in_region",
            from: { x: 0, y: 0, z: 0 },
            to: { x: 0, y: 0, z: 0 },
            fromBlock: "minecraft:oak_log",
            toBlock: "minecraft:air",
          },
          {
            type: "cylinder",
            center: { x: 0, y: 0, z: 0 },
            radius: 3,
            height: 5,
            block: "minecraft:stone",
            hollow: false,
            axis: "y",
          },
        ],
      },
    ],
    reply: "short player-facing text",
    needsMoreInfo: false,
    clarification: "optional string",
  };

  return [
    {
      role: "system" as const,
      content:
        [
          "You are a Minecraft building planner.",
          "Return exactly one JSON object and nothing else.",
          "Do not use markdown fences.",
          "Do not explain your reasoning.",
          "Keep plans bounded to the speaking player's current world and nearby area.",
          "Use multi-pass planning with passes and primitives.",
          "The request includes recentMessages, which are the player's prior recent bot prompts in chronological order.",
          "Use recentMessages to resolve clarification follow-ups and short replies, but treat message as the latest instruction.",
          "If the request is ambiguous, unsupported, or under-specified, return needsMoreInfo=true, passes=[], and a short clarification.",
          "Intent is a short snake_case label describing the requested operation.",
          "Use unknown when the request is ambiguous or unsupported.",
          "Only emit primitive types that include all required fields shown in the schema guide.",
          "clear_region does not include a block field.",
          "Prefer symbolic material slots over free-form block names. Use symbolic slots when the player has not specified a particular material, so the server can pick the best block from the local environment.",
          "Only use a concrete block id when the player has explicitly named that specific material (for example 'glass tower' → minecraft:glass, 'stone house' → material:wall resolved to stone-family).",
          "Do not use vague or obsolete block ids like minecraft:wood or minecraft:wool. Use symbolic slots or concrete default variants instead.",
          "Supported symbolic slots: material:wall, material:roof, material:floor, material:trim, material:detail, material:wood, material:stone, material:glass, material:wool.",
          "Keep symbolic slots semantically correct for their purpose (for example roof primitives use material:roof, wall primitives use material:wall).",
          "Do not invent coordinates, regions, or target areas when asking for clarification.",
          "Use short player-facing reply text.",
          `Schema guide: ${JSON.stringify(schemaGuide)}`,
        ].join(" "),
    },
    {
      role: "user" as const,
      content: [
        "Plan this Minecraft build request as JSON.",
        buildNearbyContextSummary(request),
        JSON.stringify(request, null, 2),
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}
