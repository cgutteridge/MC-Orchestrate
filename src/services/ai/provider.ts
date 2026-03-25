import type { AppConfig } from "../../config/env.js";
import { AzureOpenAIChatProvider } from "./azureOpenAIClient.js";
import { OpenAIChatProvider } from "./openAIClient.js";
import type { ChatProvider } from "./types.js";

/**
 * Creates the configured chat provider, or returns `undefined` when no
 * supported provider credentials are present in the supplied config.
 */
export function createChatProvider(config: AppConfig): ChatProvider | undefined {
  if (!config.aiProvider) {
    return undefined;
  }

  if (config.aiProvider.kind === "openai") {
    return new OpenAIChatProvider(
      config.aiProvider.apiKey,
      config.aiProvider.model,
      config.aiProvider.baseUrl,
      config.aiProvider.chatTimeoutMs,
      config.ai.providerLogPath,
    );
  }

  return new AzureOpenAIChatProvider(
    config.aiProvider.endpoint,
    config.aiProvider.apiKey,
    config.aiProvider.apiVersion,
    config.aiProvider.deployment,
    config.aiProvider.chatTimeoutMs,
    config.aiProvider.chatStream,
    config.aiProvider.useResponses,
    config.aiProvider.responsesApiVersion,
    config.ai.providerLogPath,
    config.aiProvider.policyId,
  );
}
