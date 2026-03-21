import type { ChatCommandRequest } from "../types/plugin.js";

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
            type: "fill_cuboid | hollow_cuboid",
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
          "Prefer concrete modern block ids such as minecraft:oak_planks, minecraft:oak_fence, minecraft:grass_block, minecraft:stone, minecraft:cobblestone, minecraft:glass, and minecraft:white_wool.",
          "Do not use vague or obsolete block names like minecraft:wood or minecraft:wool when a concrete default variant is intended.",
          "You may use symbolic material slots in block fields when exact materials are unclear: material:wall, material:roof, material:floor, material:trim, material:detail, material:wood, material:stone, material:glass, material:wool.",
          "When using symbolic slots, keep them semantically correct for the primitive's purpose (for example roof uses material:roof).",
          "Do not invent coordinates, regions, or target areas when asking for clarification.",
          "Use short player-facing reply text.",
          `Schema guide: ${JSON.stringify(schemaGuide)}`,
        ].join(" "),
    },
    {
      role: "user" as const,
      content: [
        "Plan this Minecraft build request as JSON.",
        JSON.stringify(request, null, 2),
      ].join("\n\n"),
    },
  ];
}
