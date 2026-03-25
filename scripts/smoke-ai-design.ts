/**
 * Smoke: design phase only (`design_choice` — step 2 of 3).
 *
 * Usage:
 *   npx tsx scripts/smoke-ai-design.ts "build a cottage"
 *
 * Requires the same AI env as the app (see `.env.example`).
 */
import { loadConfig } from "../src/config/env.js";
import { resetMessagesForDesignPhase } from "../src/planner/prompt.js";
import type { ChatMessage } from "../src/services/ai/types.js";
import { createChatProvider } from "../src/services/ai/provider.js";
import {
  createSmokeChatRequest,
  formatMessagesForStdout,
  parseDesignChoiceFromAssistantText,
} from "./smoke/shared.js";

const message =
  process.argv.slice(2).join(" ").trim() || "build a small stone house in front of me";

async function main(): Promise<void> {
  const config = loadConfig();
  const provider = createChatProvider(config);
  if (!provider) {
    process.stderr.write(
      "No AI provider configured. Set OPENAI_API_KEY and OPENAI_MODEL, or " +
        "AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION, " +
        "AZURE_OPENAI_DEPLOYMENT in the environment or .env.\n",
    );
    process.exit(1);
  }

  const request = createSmokeChatRequest(message);
  const messages: ChatMessage[] = [];
  resetMessagesForDesignPhase(messages, request, undefined);

  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(`--- Calling ${provider.name} (temperature 0.2) — design step…\n\n`);

  const raw = await provider.chat(messages, { temperature: 0.2 });
  process.stdout.write(raw);
  process.stdout.write("\n");

  const result = parseDesignChoiceFromAssistantText(raw);
  if (!result.ok) {
    process.stderr.write(`FAIL: ${result.error}\n`);
    process.exit(1);
  }
  process.stdout.write("\nOK: design_choice parsed\n");
  process.stdout.write(`  designSummary: ${result.design.designSummary}\n`);
  process.stdout.write(
    `  desiredSize: ${result.design.desiredSize.width}×${result.design.desiredSize.depth}×${result.design.desiredSize.height}\n`,
  );
  process.stdout.write(`  verticalReference: ${result.design.verticalReference}\n`);
  process.stdout.write(
    `  recommendedMaterials: ${result.design.recommendedMaterials.join(", ")}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
