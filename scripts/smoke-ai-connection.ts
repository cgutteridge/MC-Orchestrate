/**
 * Minimal connectivity check: one tiny chat completion through the configured
 * AI provider (same code path as placement-then-build). Does not load Minecraft prompts.
 *
 * Usage:
 *   npx tsx scripts/smoke-ai-connection.ts
 *   npm run smoke:ai
 *
 * Requires either `OPENAI_API_KEY` + `OPENAI_MODEL`, or the Azure OpenAI env set
 * used by the app (see `.env.example`).
 * Set `MCORCH_AI_CHAT_DEBUG=1` for request timings on stderr when using Azure.
 */
import { performance } from "node:perf_hooks";
import { loadConfig } from "../src/config/env.js";
import { createChatProvider } from "../src/services/ai/provider.js";

/** Deliberately tiny to minimize tokens and latency. */
const PING_MESSAGE = "Reply with exactly the single word: OK";

/**
 * Runs the connectivity check and exits the process with 0 or 1.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const provider = createChatProvider(config);
  if (!provider) {
    process.stderr.write(
      "FAIL: No AI provider configured. Set OPENAI_API_KEY and OPENAI_MODEL, or " +
        "AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION, " +
        "AZURE_OPENAI_DEPLOYMENT (see .env.example).\n",
    );
    process.exit(1);
  }

  const t0 = performance.now();
  try {
    const reply = await provider.chat([{ role: "user", content: PING_MESSAGE }], {
      temperature: 0,
    });
    const ms = Math.round(performance.now() - t0);
    const preview = truncateOneLine(reply.trim(), 240);
    process.stdout.write(
      `OK: ${provider.name} responded in ${ms}ms.\n` + `Assistant preview: ${preview}\n`,
    );
    process.exit(0);
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`FAIL after ${ms}ms: ${msg}\n`);
    if (err instanceof Error && err.cause instanceof Error) {
      process.stderr.write(`Cause: ${err.cause.message}\n`);
    }
    process.exit(1);
  }
}

/**
 * Truncates text for a one-line preview in the terminal.
 */
function truncateOneLine(s: string, maxChars: number): string {
  const oneLine = s.replace(/\s+/g, " ");
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`;
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
