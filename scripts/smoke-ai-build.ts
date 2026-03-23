/**
 * Smoke: **step 2 (build) only** — layer-map `build` with minimal user
 * context (same path as production after `resetMessagesForPlanPhase`).
 *
 * Uses a fixed locked placement fixture; does not call step 1.
 *
 * Usage:
 *   npx tsx scripts/smoke-ai-build.ts "a cottage with a door"
 *
 * Requires the same AI env as the app (see `.env.example`).
 */
import { loadConfig } from "../src/config/env.js";
import type { ChatMessage } from "../src/services/ai/types.js";
import { resetMessagesForPlanPhase } from "../src/planner/prompt.js";
import { createChatProvider } from "../src/services/ai/provider.js";
import {
  createSmokeChatRequest,
  DEFAULT_LOCKED_PLACEMENT,
  formatMessagesForStdout,
  printLayerMapPreviewFromAssistantText,
} from "./smoke/shared.js";

const message =
  process.argv.slice(2).join(" ").trim() || "make a castle with battlements and a moat";

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
  const messages: ChatMessage[] = [];
  resetMessagesForPlanPhase(messages, request, DEFAULT_LOCKED_PLACEMENT, undefined);

  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(
    `--- Locked placement fixture: ${JSON.stringify(DEFAULT_LOCKED_PLACEMENT)}\n`,
  );
  process.stdout.write(`--- Calling ${provider.name} (temperature 0.2) — build step…\n\n`);

  const raw = await provider.chat(messages, { temperature: 0.2 });
  process.stdout.write(raw);
  process.stdout.write("\n");

  printLayerMapPreviewFromAssistantText(raw);
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
