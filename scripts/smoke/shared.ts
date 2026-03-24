/**
 * Shared fixtures and output helpers for AI smoke scripts (`smoke-ai-*`).
 */
import { tryExtractLayerMapData, type LayerMapData } from "../../src/planner/layerMap.js";
import {
  DesignChoiceStepSchema,
  PlacementPositionOnlySchema,
  PlacementChoiceStepSchema,
  PlacementWithDesiredSizeSchema,
} from "../../src/planner/schema.js";
import type { DesignChoiceStep, PlacementPositionOnly } from "../../src/planner/schema.js";
import { extractJsonValue, parseJsonStrict } from "../../src/services/ai/json.js";
import type { ChatMessage } from "../../src/services/ai/types.js";
import type { ChatCommandRequest } from "../../src/types/plugin.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Result of parsing a placement-phase assistant reply into validated placement intent.
 */
export type ParsePlacementChoiceResult =
  | { ok: true; placement: PlacementPositionOnly }
  | { ok: false; error: string };

/**
 * Parses assistant text from a placement-phase turn into validated placement
 * intent (position only — no `desiredSize`).
 *
 * @param raw Raw assistant message (may include markdown fences or prose).
 */
export function parsePlacementChoiceFromAssistantText(raw: string): ParsePlacementChoiceResult {
  const jsonText = extractJsonValue(raw);
  if (!jsonText) {
    return { ok: false, error: "No JSON object in assistant reply" };
  }
  let parsed: unknown;
  try {
    parsed = parseJsonStrict<unknown>(jsonText);
  } catch {
    return { ok: false, error: "Assistant JSON was not parseable" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Expected JSON object" };
  }
  const direct = PlacementPositionOnlySchema.safeParse(parsed);
  if (direct.success) {
    return { ok: true, placement: direct.data };
  }
  const wrapped = PlacementChoiceStepSchema.safeParse(parsed);
  if (wrapped.success) {
    return { ok: true, placement: wrapped.data.placement };
  }
  return { ok: false, error: "Expected placement JSON shape: {ref, frame, offset}" };
}

/**
 * Result of parsing a design-phase assistant reply into a validated `design_choice`.
 */
export type ParseDesignChoiceResult =
  | { ok: true; design: DesignChoiceStep }
  | { ok: false; error: string };

/**
 * Parses assistant text from a design-phase turn into a validated `design_choice`.
 *
 * @param raw Raw assistant message (may include markdown fences or prose).
 */
export function parseDesignChoiceFromAssistantText(raw: string): ParseDesignChoiceResult {
  const jsonText = extractJsonValue(raw);
  if (!jsonText) {
    return { ok: false, error: "No JSON object in assistant reply" };
  }
  let parsed: unknown;
  try {
    parsed = parseJsonStrict<unknown>(jsonText);
  } catch {
    return { ok: false, error: "Assistant JSON was not parseable" };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "Expected JSON object" };
  }
  const result = DesignChoiceStepSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, design: result.data };
}

const SMOKE_FOOTPRINT = { width: 10, depth: 10, height: 20 } as const;

/**
 * Default design fixture for build-step smoke (`smoke-ai-build.ts`).
 */
export const DEFAULT_SMOKE_DESIGN: DesignChoiceStep = DesignChoiceStepSchema.parse({
  action: "design_choice",
  designSummary: "A tall, spiraling wizard tower with a cozy study at the top.",
  builderGuide:
    "Start by creating a circular base with stone bricks. Build the tower upwards using a mix of stone and wood, adding spiral stairs inside. At the top, create a small room for the study with large windows for light. Decorate the interior with bookshelves and a desk.",
  desiredSize: SMOKE_FOOTPRINT,
  verticalReference: "on_ground",
  recommendedMaterials: ["stone_bricks", "oak_planks", "glass", "bookshelf", "ladder"],
});

/**
 * Merged placement for build-step smoke (matches {@link DEFAULT_SMOKE_DESIGN} footprint).
 */
export const DEFAULT_LOCKED_PLACEMENT = PlacementWithDesiredSizeSchema.parse({
  ref: "player",
  frame: "player",
  offset: { F: 10, R: 0, N: 0, E: 0, UP: 0 },
  desiredSize: SMOKE_FOOTPRINT,
  verticalReference: "on_ground",
});

/**
 * Synthetic in-game request used by smoke scripts (player at origin, small grass patch).
 *
 * @param message Player chat line for this turn.
 */
export function createSmokeChatRequest(message: string): ChatCommandRequest {
  return {
    requestId: `smoke-${Date.now()}`,
    message,
    player: {
      uuid: "smoke-uuid",
      name: "SmokeTest",
      world: "world",
      position: { x: 0, y: 64, z: 0 },
      yaw: 0,
      pitch: 0,
      lookVector: { x: 0, y: 0, z: 1 },
    },
    recentMessages: [],
    localContext: {
      nearbyBlocks: [
        { x: 0, y: 63, z: 0, type: "minecraft:grass_block" },
        { x: 1, y: 63, z: 0, type: "minecraft:grass_block" },
      ],
      nearbyEntities: [],
      nearbyPlayers: [],
    },
    serverContext: {
      timestamp: new Date().toISOString(),
      dimension: "minecraft:overworld",
      onlinePlayerCount: 1,
    },
    initialScanRegion: {
      minX: -7,
      minY: 61,
      minZ: -7,
      maxX: 7,
      maxY: 69,
      maxZ: 7,
    },
  };
}

/**
 * Pretty-prints the exact chat payload (system + user) passed to the AI provider.
 */
export function formatMessagesForStdout(messages: ChatMessage[]): string {
  const lines: string[] = ["=== Messages sent to the model ===", ""];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    lines.push(`--- ${m.role} (${i + 1}/${messages.length}) ---`);
    lines.push(m.content);
    lines.push("");
  }
  lines.push("=== End messages ===");
  lines.push("");
  return lines.join("\n");
}

/**
 * Each layer string in order (bottom Y → top Y), separated by a blank line.
 */
export function formatLayerMapForDisplay(layerMap: LayerMapData): string {
  return layerMap.layers.join("\n\n");
}

/**
 * Prints a layer-map preview from assistant text (bare `layers`/`palette`, legacy `plan`, or `passes`).
 */
export function printLayerMapPreviewFromAssistantText(raw: string): void {
  const jsonText = extractJsonValue(raw);
  if (!jsonText) {
    process.stdout.write("\n--- No JSON in assistant reply ---\n");
    return;
  }
  let parsed: unknown;
  try {
    parsed = parseJsonStrict<unknown>(jsonText);
  } catch {
    process.stdout.write("\n--- Assistant JSON was not parseable ---\n");
    return;
  }
  if (!isRecord(parsed)) {
    process.stdout.write("\n--- Assistant JSON was not an object ---\n");
    return;
  }
  const lm = tryExtractLayerMapData(parsed);
  if (!lm) {
    process.stdout.write("\n--- No layers/palette in reply ---\n");
    return;
  }
  process.stdout.write("\n" + formatLayerMapForDisplay(lm) + "\n");
}
