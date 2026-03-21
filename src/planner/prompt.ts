import type { ChatCommandRequest } from "../types/plugin.js";

/**
 * Builds the planner prompt/messages sent to the LLM for structured build planning.
 */
export function buildPlannerMessages(request: ChatCommandRequest) {
  const schemaGuide = {
    intent: "remove_tree | build_tower | build_house | unknown",
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
            type:
              "set_block | fill_cuboid | hollow_cuboid | clear_region | replace_in_region | cylinder",
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
          "If the request is ambiguous, return needsMoreInfo=true and a short clarification.",
          "Supported intents are remove_tree, build_tower, build_house, unknown.",
          "Allowed primitive types are set_block, fill_cuboid, hollow_cuboid, clear_region, replace_in_region, cylinder.",
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
