import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./env.js";

const ORIGINAL_ENV = { ...process.env };
const AI_ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_CHAT_TIMEOUT_MS",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_DEPLOYMENT",
  "AZURE_OPENAI_POLICY_ID",
  "AZURE_OPENAI_CHAT_TIMEOUT_MS",
  "AZURE_OPENAI_CHAT_STREAM",
  "AZURE_OPENAI_USE_RESPONSES",
  "AZURE_OPENAI_RESPONSES_API_VERSION",
  "MCORCH_AI_PROVIDER_LOG",
  "MCORCH_FULL_LOGGING",
] as const;

function resetProviderEnv(): void {
  process.env = { ...ORIGINAL_ENV };
  for (const key of AI_ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  resetProviderEnv();
});

describe("loadConfig", () => {
  it("selects direct OpenAI when OPENAI_API_KEY and OPENAI_MODEL are set", () => {
    resetProviderEnv();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";

    const config = loadConfig();

    expect(config.aiProvider).toEqual({
      kind: "openai",
      apiKey: "test-openai-key",
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      chatTimeoutMs: 900_000,
    });
  });

  it("falls back to Azure OpenAI when direct OpenAI env is absent", () => {
    resetProviderEnv();
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "test-azure-key";
    process.env.AZURE_OPENAI_API_VERSION = "2024-10-21";
    process.env.AZURE_OPENAI_DEPLOYMENT = "gpt-4o-mini";

    const config = loadConfig();

    expect(config.aiProvider).toMatchObject({
      kind: "azure-openai",
      endpoint: "https://example.openai.azure.com",
      apiKey: "test-azure-key",
      apiVersion: "2024-10-21",
      deployment: "gpt-4o-mini",
      chatTimeoutMs: 900_000,
      chatStream: true,
      useResponses: true,
      responsesApiVersion: "preview",
    });
  });

  it("prefers direct OpenAI when both env sets are present", () => {
    resetProviderEnv();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENAI_MODEL = "gpt-4o-mini";
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "test-azure-key";
    process.env.AZURE_OPENAI_API_VERSION = "2024-10-21";
    process.env.AZURE_OPENAI_DEPLOYMENT = "azure-deployment";

    const config = loadConfig();

    expect(config.aiProvider).toMatchObject({
      kind: "openai",
      apiKey: "test-openai-key",
      model: "gpt-4o-mini",
    });
  });

  it("enables the provider dump log when full logging is set", () => {
    resetProviderEnv();
    process.env.MCORCH_FULL_LOGGING = "1";

    const config = loadConfig();

    expect(config.ai.providerLogPath).toBe("logs/ai-provider.log");
  });

  it("prefers an explicit provider dump log path over full logging defaults", () => {
    resetProviderEnv();
    process.env.MCORCH_FULL_LOGGING = "1";
    process.env.MCORCH_AI_PROVIDER_LOG = "logs/custom-provider.log";

    const config = loadConfig();

    expect(config.ai.providerLogPath).toBe("logs/custom-provider.log");
  });
});
