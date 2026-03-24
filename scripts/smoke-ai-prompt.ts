/**
 * Smoke: **full position → design → build prompt path** — three API calls:
 * 1. `buildPlacementPhaseMessages` → `placement_choice`
 * 2. `resetMessagesForDesignPhase` → `design_choice`
 * 3. `resetMessagesForPlanPhase` → `build` with layer map
 *
 * For step 1 only, use `npx tsx scripts/smoke-ai-placement.ts`.
 * For step 3 with fixed fixtures, use `npx tsx scripts/smoke-ai-build.ts`.
 *
 * Usage:
 *   npx tsx scripts/smoke-ai-prompt.ts "your message here"
 *   npm run smoke:ai:prompt
 *
 * Requires AZURE_OPENAI_* (or whatever createChatProvider needs) in the environment.
 * If requests abort with a timeout, set AZURE_OPENAI_CHAT_TIMEOUT_MS (default 900000 ms).
 */
import { loadConfig } from "../src/config/env.js";
import {
  buildPlacementPhaseMessages,
  resetMessagesForDesignPhase,
  resetMessagesForPlanPhase,
} from "../src/planner/prompt.js";
import type { DesignChoiceStep, Placement, PlacementPositionOnly } from "../src/planner/schema.js";
import type { ChatMessage } from "../src/services/ai/types.js";
import { createChatProvider } from "../src/services/ai/provider.js";
import {
  createSmokeChatRequest,
  formatMessagesForStdout,
  parseDesignChoiceFromAssistantText,
  parsePlacementChoiceFromAssistantText,
  printLayerMapPreviewFromAssistantText,
} from "./smoke/shared.js";

const message =
  process.argv.slice(2).join(" ").trim() || "make a castle with battlements and a moat";

/**
 * Combines position-only placement with design footprint and vertical reference (same merge as production).
 *
 * @param position Step-1 placement.
 * @param design Validated design_choice.
 */
function mergePlacementForBuild(position: PlacementPositionOnly, design: DesignChoiceStep): Placement {
  return { ...position, desiredSize: design.desiredSize, verticalReference: design.verticalReference };
}

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
  const messages: ChatMessage[] = buildPlacementPhaseMessages(request, undefined);
  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(`--- Calling ${provider.name} (temperature 0.2) — placement step…\n\n`);

  const rawPlacement = await provider.chat(messages, { temperature: 0.2 });
  process.stdout.write(rawPlacement);
  process.stdout.write("\n");

  const placementResult = parsePlacementChoiceFromAssistantText(rawPlacement);
  if (!placementResult.ok) {
    process.stderr.write(`FAIL (placement step): ${placementResult.error}\n`);
    process.exit(1);
  }

  resetMessagesForDesignPhase(messages, request, undefined);

  process.stdout.write("\n");
  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(`--- Calling ${provider.name} (temperature 0.2) — design step…\n\n`);

  const rawDesign = await provider.chat(messages, { temperature: 0.2 });
  process.stdout.write(rawDesign);
  process.stdout.write("\n");

  const designResult = parseDesignChoiceFromAssistantText(rawDesign);
  if (!designResult.ok) {
    process.stderr.write(`FAIL (design step): ${designResult.error}\n`);
    process.exit(1);
  }

  const merged = mergePlacementForBuild(placementResult.placement, designResult.design);
  resetMessagesForPlanPhase(messages, request, merged, designResult.design, false);

  process.stdout.write("\n");
  process.stdout.write(formatMessagesForStdout(messages));
  process.stdout.write(`--- Calling ${provider.name} (temperature 0.2) — build step…\n\n`);

  const rawBuild = await provider.chat(messages, { temperature: 0.2 });
  process.stdout.write(rawBuild);
  process.stdout.write("\n");

  printLayerMapPreviewFromAssistantText(rawBuild);
}

main().catch((err) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.stderr.write("\n");
  process.exit(1);
});
