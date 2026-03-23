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
import {
  createSmokeChatRequest,
  formatMessagesForStdout,
  parsePlacementChoiceFromAssistantText,
} from "./smoke/shared.js";

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

  const result = parsePlacementChoiceFromAssistantText(raw);
  if (!result.ok) {
    process.stderr.write(`FAIL: ${result.error}\n`);
    process.exit(1);
  }
  process.stdout.write("\nOK: placement_choice\n");
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
