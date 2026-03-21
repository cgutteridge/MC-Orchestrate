import { loadConfig } from "../../config/env.js";
import { AzureOpenAIChatProvider } from "./azureOpenAIClient.js";
import type { ChatProvider } from "./types.js";

/**
 * Creates the configured chat provider, or returns `undefined` when AI planning is disabled.
 */
export function createChatProvider(
  debug = false,
  logPath?: string,
): ChatProvider | undefined {
  const config = loadConfig();
  if (!config.azureOpenAI) {
    return undefined;
  }

  return new AzureOpenAIChatProvider(
    config.azureOpenAI.endpoint,
    config.azureOpenAI.apiKey,
    config.azureOpenAI.apiVersion,
    config.azureOpenAI.deployment,
    debug,
    logPath,
    config.azureOpenAI.policyId,
  );
}
