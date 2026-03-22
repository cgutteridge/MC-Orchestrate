/**
 * One-shot: send a single user prompt through the same system prompt + user
 * envelope as the design loop (no bridge). Usage:
 *   npx tsx scripts/smoke-ai-prompt.ts "your message here"
 *
 * Requires AZURE_OPENAI_* (or whatever createChatProvider needs) in the environment.
 *
 * When the model returns JSON with `passes[0].layerMap`, prints that object
 * as formatted JSON. If only `primitives` are present (legacy / tests with
 * MCORCH_LAYER_MAP_ONLY=false), prints {@link formatPrimitivesAsLayerMapJson}.
 */
import { loadConfig } from "../src/config/env.js";
import { formatPrimitivesAsLayerMapJson } from "../src/planner/primitivesToLayerMap.js";
import { buildInitialMessages } from "../src/planner/prompt.js";
import { createChatProvider } from "../src/services/ai/provider.js";
import type { Primitive } from "../src/planner/schema.js";
import { extractJsonValue, parseJsonStrict } from "../src/services/ai/json.js";
import type { ChatCommandRequest } from "../src/types/plugin.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
  process.stdout.write(`--- Prompt (user message field): ${JSON.stringify(message)}\n`);
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

  const layerMap = firstPass.layerMap;
  if (isRecord(layerMap) && Array.isArray(layerMap.layers)) {
    process.stdout.write(
      "\n--- Layer map JSON (first pass, for debugging) ---\n",
    );
    process.stdout.write(JSON.stringify(layerMap, null, 2) + "\n");
    return;
  }

  const primitives = firstPass.primitives;
  if (!Array.isArray(primitives) || primitives.length === 0) {
    process.stdout.write(
      "\n--- No layerMap or primitives on first pass (nothing to preview) ---\n",
    );
    return;
  }

  process.stdout.write(
    "\n--- Primitives as layer map JSON (first pass, for debugging) ---\n",
  );
  process.stdout.write(
    formatPrimitivesAsLayerMapJson(primitives as Primitive[]) + "\n",
  );
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? err.stack ?? err.message : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
