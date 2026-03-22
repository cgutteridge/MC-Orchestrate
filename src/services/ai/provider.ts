import type { AppConfig } from "../../config/env.js";
import { AzureOpenAIChatProvider } from "./azureOpenAIClient.js";
import type { ChatProvider } from "./types.js";

/**
 * Creates the configured chat provider, or returns `undefined` when Azure
 * OpenAI credentials are absent from the supplied config.
 */
export function createChatProvider(config: AppConfig): ChatProvider | undefined {
  if (!config.azureOpenAI) {
    return undefined;
  }

  return new AzureOpenAIChatProvider(
    config.azureOpenAI.endpoint,
    config.azureOpenAI.apiKey,
    config.azureOpenAI.apiVersion,
    config.azureOpenAI.deployment,
    config.azureOpenAI.chatTimeoutMs,
    config.ai.providerLogPath,
    config.azureOpenAI.policyId,
  );
}
