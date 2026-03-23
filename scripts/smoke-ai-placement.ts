/**
 * Smoke: **step 1 (location) only** — `placement_choice`.
 *
 * Usage:
 *   npx tsx scripts/smoke-ai-placement.ts "build a cottage"
 *
 * Requires the same AI env as the app (see `.env.example`).
 */
import { loadConfig } from "../src/config/env.js";
import { buildPlacementPhaseMessages } from "../src/planner/prompt.js";
import { createChatProvider } from "../src/services/ai/provider.js";
import { extractJsonValue, parseJsonStrict } from "../src/services/ai/json.js";
import { createSmokeChatRequest, formatMessagesForStdout } from "./smoke/shared.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const message =
  process.argv.slice(2).join(" ").trim() || "build a small stone house in front of me";

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

  const request = createSmokeChatRequest(message);
  const messages = buildPlacementPhaseMessages(request, undefined);
  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(`--- Calling ${provider.name} (temperature 0.2) — placement step…\n\n`);

  const raw = await provider.chat(messages, { temperature: 0.2 });
  process.stdout.write(raw);
  process.stdout.write("\n");

  const jsonText = extractJsonValue(raw);
  if (!jsonText) {
    process.stderr.write("FAIL: no JSON object in assistant reply.\n");
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = parseJsonStrict<unknown>(jsonText);
  } catch {
    process.stderr.write("FAIL: assistant JSON was not parseable.\n");
    process.exit(1);
  }
  if (!isRecord(parsed) || typeof parsed.action !== "string") {
    process.stderr.write("FAIL: expected object with action.\n");
    process.exit(1);
  }
  const action = parsed.action;
  if (action === "placement_choice") {
    process.stdout.write(`\nOK: ${action}\n`);
    process.exit(0);
  }
  process.stderr.write(`FAIL: expected action placement_choice, got ${String(action)}.\n`);
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
