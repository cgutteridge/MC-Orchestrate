/**
 * One-shot: send a single user prompt through the same system prompt + user
 * envelope as the design loop (no bridge). Usage:
 *   npx tsx scripts/smoke-ai-prompt.ts "your message here"
 *
 * Requires AZURE_OPENAI_* (or whatever createChatProvider needs) in the environment.
 * If requests abort with a timeout, set AZURE_OPENAI_CHAT_TIMEOUT_MS (default 300000 ms).
 * Set MCORCH_MINIMAL_INITIAL_PROMPT=true to use a tiny experimental prompt (debugging only).
 *
 * Prints the full system and user messages before calling the API. When the
 * model returns `passes[0].layerMap`, prints each `layers[i]` string in
 * order with a blank line between layers (newlines inside a string are preserved).
 * If only `primitives` are present (legacy / MCORCH_LAYER_MAP_ONLY=false), expands
 * to a layer map and prints the same way.
 */
import { loadConfig } from "../src/config/env.js";
import type { LayerMapData } from "../src/planner/layerMap.js";
import {
  primitivesToLayerMapData,
} from "../src/planner/primitivesToLayerMap.js";
import { buildInitialMessages } from "../src/planner/prompt.js";
import { createChatProvider } from "../src/services/ai/provider.js";
import type { ChatMessage } from "../src/services/ai/types.js";
import type { Primitive } from "../src/planner/schema.js";
import { extractJsonValue, parseJsonStrict } from "../src/services/ai/json.js";
import type { ChatCommandRequest } from "../src/types/plugin.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Each layer string in order (top Y → bottom Y), separated by a blank line.
 */
function formatLayerMapForDisplay(layerMap: LayerMapData): string {
  return layerMap.layers.join("\n\n");
}

/**
 * Pretty-prints the exact chat payload (system + user) passed to the AI provider.
 */
function formatMessagesForStdout(messages: ChatMessage[]): string {
  const lines: string[] = [
    "=== Messages sent to the model (same as design loop) ===",
    "",
  ];
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

const message =
  process.argv.slice(2).join(" ").trim() ||
  "make a castle with battlements and a moat";

const request: ChatCommandRequest = {
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

async function main(): Promise<void> {
  const config = loadConfig();
  const provider = createChatProvider(config);
  if (!provider) {
    process.stderr.write(
      "No AI provider configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, " +
        "AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT in the environment or .env.\n",
    );
    process.exit(1);
  }

  const messages = buildInitialMessages(request, undefined);
  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(`--- Calling ${provider.name} (temperature 0.2)…\n\n`);

  const raw = await provider.chat(messages, { temperature: 0.2 });
  process.stdout.write(raw);
  process.stdout.write("\n");

  const jsonText = extractJsonValue(raw);
  if (!jsonText) {
    return;
  }
  let parsed: unknown;
  try {
    parsed = parseJsonStrict<unknown>(jsonText);
  } catch {
    return;
  }
  const planRoot =
    isRecord(parsed) && parsed.action === "build" && isRecord(parsed.plan)
      ? parsed.plan
      : parsed;
  if (!isRecord(planRoot)) {
    return;
  }
  const passes = planRoot.passes;
  if (!Array.isArray(passes) || passes.length === 0) {
    return;
  }
  const firstPass = passes[0];
  if (!isRecord(firstPass)) {
    return;
  }

  const layerMapRaw = firstPass.layerMap;
  if (isRecord(layerMapRaw) && Array.isArray(layerMapRaw.layers)) {
    const lm: LayerMapData = {
      layers: layerMapRaw.layers as string[],
      palette: isRecord(layerMapRaw.palette)
        ? (layerMapRaw.palette as Record<string, string>)
        : {},
    };
    process.stdout.write("\n" + formatLayerMapForDisplay(lm) + "\n");
    return;
  }

  const primitives = firstPass.primitives;
  if (!Array.isArray(primitives) || primitives.length === 0) {
    process.stdout.write(
      "\n--- No layerMap or primitives on first pass (nothing to preview) ---\n",
    );
    return;
  }

  const expanded = primitivesToLayerMapData(primitives as Primitive[]);
  if (!expanded.ok) {
    process.stdout.write("\n" + expanded.error + "\n");
    return;
  }
  process.stdout.write("\n" + formatLayerMapForDisplay(expanded.layerMap) + "\n");
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? err.stack ?? err.message : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
