import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

/** Default chat completion timeout when provider-specific timeout env vars are unset. */
export const DEFAULT_AI_CHAT_TIMEOUT_MS = 900_000;
/** Backward-compatible alias for existing Azure timeout references. */
export const DEFAULT_AZURE_OPENAI_CHAT_TIMEOUT_MS = DEFAULT_AI_CHAT_TIMEOUT_MS;

const optionalNonEmpty = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const Schema = z.object({
  AZURE_OPENAI_ENDPOINT: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().url().optional(),
  ),
  AZURE_OPENAI_API_KEY: optionalNonEmpty,
  AZURE_OPENAI_API_VERSION: optionalNonEmpty,
  AZURE_OPENAI_DEPLOYMENT: optionalNonEmpty,
  AZURE_OPENAI_POLICY_ID: optionalNonEmpty,
  OPENAI_API_KEY: optionalNonEmpty,
  OPENAI_MODEL: optionalNonEmpty,
  OPENAI_BASE_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().url().optional(),
  ),
  MCORCH_HOST: optionalNonEmpty,
  MCORCH_PORT: optionalNonEmpty,
  MCORCH_HTTP_HOST: optionalNonEmpty,
  MCORCH_HTTP_PORT: optionalNonEmpty,
  MINECRAFT_DIR: optionalNonEmpty,
  MINECRAFT_JAR: optionalNonEmpty,
  JAVA_BIN: optionalNonEmpty,
  MCORCH_ACTION_LOG: optionalNonEmpty,
  MCORCH_AI_LOG: optionalNonEmpty,
  MCORCH_AI_PROVIDER_LOG: optionalNonEmpty,
  MCORCH_AI_PLAN_LOG: optionalNonEmpty,
  MCORCH_AI_PLAN_MAX_STEPS: z.preprocess(
    (value) =>
      value === undefined || value === "" || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.coerce.number().int().min(1).max(50).optional(),
  ),
  /** HTTP timeout for Azure chat completions (ms). Applies to the full request including streaming body. */
  AZURE_OPENAI_CHAT_TIMEOUT_MS: z.preprocess(
    (value) =>
      value === undefined || value === "" || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.coerce.number().int().min(5_000).max(3_600_000).optional(),
  ),
  /** When true (default), use chat completions streaming so headers return quickly; set false for buffered JSON only. */
  AZURE_OPENAI_CHAT_STREAM: z.preprocess(
    (value) =>
      value === undefined || value === "" || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.enum(["true", "false", "1", "0"]).optional(),
  ),
  /** When true (default), use Responses API `POST .../openai/v1/responses` instead of Chat Completions. */
  AZURE_OPENAI_USE_RESPONSES: z.preprocess(
    (value) =>
      value === undefined || value === "" || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.enum(["true", "false", "1", "0"]).optional(),
  ),
  /** `api-version` for the Responses route (Azure often uses `preview`). */
  AZURE_OPENAI_RESPONSES_API_VERSION: optionalNonEmpty,
  /** HTTP timeout for direct OpenAI chat completions (ms). */
  OPENAI_CHAT_TIMEOUT_MS: z.preprocess(
    (value) =>
      value === undefined || value === "" || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.coerce.number().int().min(5_000).max(3_600_000).optional(),
  ),
});

export type AiProviderConfig =
  | {
      kind: "openai";
      apiKey: string;
      model: string;
      baseUrl: string;
      chatTimeoutMs: number;
    }
  | {
      kind: "azure-openai";
      endpoint: string;
      apiKey: string;
      apiVersion: string;
      deployment: string;
      policyId?: string;
      /** Upper bound on a single chat completion (upload through end of streamed or buffered response). */
      chatTimeoutMs: number;
      /** Use SSE streaming for chat completions (recommended; avoids long waits for HTTP headers). */
      chatStream: boolean;
      /** Prefer Azure OpenAI Responses API over Chat Completions. */
      useResponses: boolean;
      /** Query `api-version` for `POST .../openai/v1/responses`. */
      responsesApiVersion: string;
    };

export type AppConfig = {
  aiProvider?: AiProviderConfig;
  minecraft: {
    tcpHost: string;
    tcpPort: number;
    httpHost: string;
    httpPort: number;
    minecraftDir: string;
    minecraftJar: string;
    javaBin?: string;
    actionLogPath: string;
  };
  ai: {
    plannerLogPath: string;
    providerLogPath: string;
    /** Human-readable log for placement-then-build AI progress. */
    aiPlanLogPath: string;
    /** Max AI calls per chat request (placement + build + retries). */
    aiPlanMaxSteps: number;
  };
};

/**
 * Loads and validates environment-driven application configuration.
 */
export function loadConfig(): AppConfig {
  const parsed = Schema.parse(process.env);
  const openAIConfigured = parsed.OPENAI_API_KEY && parsed.OPENAI_MODEL;
  const azureConfigured =
    parsed.AZURE_OPENAI_ENDPOINT &&
    parsed.AZURE_OPENAI_API_KEY &&
    parsed.AZURE_OPENAI_API_VERSION &&
    parsed.AZURE_OPENAI_DEPLOYMENT;
  const aiProvider = openAIConfigured
    ? {
        kind: "openai" as const,
        apiKey: parsed.OPENAI_API_KEY!,
        model: parsed.OPENAI_MODEL!,
        baseUrl: parsed.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        chatTimeoutMs: parsed.OPENAI_CHAT_TIMEOUT_MS ?? DEFAULT_AI_CHAT_TIMEOUT_MS,
      }
    : azureConfigured
      ? {
          kind: "azure-openai" as const,
          endpoint: parsed.AZURE_OPENAI_ENDPOINT!,
          apiKey: parsed.AZURE_OPENAI_API_KEY!,
          apiVersion: parsed.AZURE_OPENAI_API_VERSION!,
          deployment: parsed.AZURE_OPENAI_DEPLOYMENT!,
          policyId: parsed.AZURE_OPENAI_POLICY_ID,
          chatTimeoutMs: parsed.AZURE_OPENAI_CHAT_TIMEOUT_MS ?? DEFAULT_AI_CHAT_TIMEOUT_MS,
          chatStream:
            parsed.AZURE_OPENAI_CHAT_STREAM === undefined ||
            parsed.AZURE_OPENAI_CHAT_STREAM === "true" ||
            parsed.AZURE_OPENAI_CHAT_STREAM === "1",
          useResponses:
            parsed.AZURE_OPENAI_USE_RESPONSES === undefined ||
            parsed.AZURE_OPENAI_USE_RESPONSES === "true" ||
            parsed.AZURE_OPENAI_USE_RESPONSES === "1",
          responsesApiVersion: parsed.AZURE_OPENAI_RESPONSES_API_VERSION ?? "preview",
        }
      : undefined;

  return {
    aiProvider,
    minecraft: {
      tcpHost: parsed.MCORCH_HOST ?? "127.0.0.1",
      tcpPort: Number.parseInt(parsed.MCORCH_PORT ?? "7070", 10),
      httpHost: parsed.MCORCH_HTTP_HOST ?? "127.0.0.1",
      httpPort: Number.parseInt(parsed.MCORCH_HTTP_PORT ?? "7071", 10),
      minecraftDir: parsed.MINECRAFT_DIR ?? "minecraft-server",
      minecraftJar: parsed.MINECRAFT_JAR ?? "spigot-1.21.1.jar",
      javaBin: parsed.JAVA_BIN,
      actionLogPath: parsed.MCORCH_ACTION_LOG ?? "logs/bridge-actions.jsonl",
    },
    ai: {
      plannerLogPath: parsed.MCORCH_AI_LOG ?? "logs/ai-planner.jsonl",
      providerLogPath: parsed.MCORCH_AI_PROVIDER_LOG ?? "logs/ai-provider.log",
      aiPlanLogPath: parsed.MCORCH_AI_PLAN_LOG ?? "logs/ai-plan.log",
      aiPlanMaxSteps: parsed.MCORCH_AI_PLAN_MAX_STEPS ?? 10,
    },
  };
}
