/**
 * Smoke: **build step only** — layer-map `build` with the same user message shape
 * as production after `resetMessagesForPlanPhase` (merged placement + design fixture).
 *
 * Uses fixed placement and design fixtures; does not call position or design steps.
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
  DEFAULT_SMOKE_DESIGN,
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
  resetMessagesForPlanPhase(
    messages,
    request,
    DEFAULT_LOCKED_PLACEMENT,
    DEFAULT_SMOKE_DESIGN,
    false,
  );

  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(
    `--- Fixtures: placement=${JSON.stringify(DEFAULT_LOCKED_PLACEMENT)} design=${JSON.stringify(DEFAULT_SMOKE_DESIGN)}\n`,
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
