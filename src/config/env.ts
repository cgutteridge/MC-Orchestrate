import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

/** Default chat completion HTTP timeout when `AZURE_OPENAI_CHAT_TIMEOUT_MS` is unset (slow links + big layer-map JSON often need several minutes). */
export const DEFAULT_AZURE_OPENAI_CHAT_TIMEOUT_MS = 300_000;

const optionalNonEmpty = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const Schema = z.object({
  AZURE_OPENAI_ENDPOINT: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().url().optional(),
  ),
  AZURE_OPENAI_API_KEY: optionalNonEmpty,
  AZURE_OPENAI_API_VERSION: optionalNonEmpty,
  AZURE_OPENAI_DEPLOYMENT: optionalNonEmpty,
  AZURE_OPENAI_POLICY_ID: optionalNonEmpty,
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
  MCORCH_DESIGN_LOOP_LOG: optionalNonEmpty,
  MCORCH_DESIGN_LOOP_MAX_TURNS: z.preprocess(
    (value) =>
      value === undefined ||
      value === "" ||
      (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.coerce.number().int().min(1).max(50).optional(),
  ),
  /** HTTP timeout for Azure chat completions (ms). Includes upload, model time, and full response download. */
  AZURE_OPENAI_CHAT_TIMEOUT_MS: z.preprocess(
    (value) =>
      value === undefined ||
      value === "" ||
      (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.coerce.number().int().min(5_000).max(1_800_000).optional(),
  ),
});

export type AppConfig = {
  azureOpenAI?: {
    endpoint: string;
    apiKey: string;
    apiVersion: string;
    deployment: string;
    policyId?: string;
    /** Upper bound on a single chat completion HTTP request (including model time). */
    chatTimeoutMs: number;
  };
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
    designLoopLogPath: string;
    designLoopMaxTurns: number;
  };
};

/**
 * Loads and validates environment-driven application configuration.
 */
export function loadConfig(): AppConfig {
  const parsed = Schema.parse(process.env);
  const azureConfigured =
    parsed.AZURE_OPENAI_ENDPOINT &&
    parsed.AZURE_OPENAI_API_KEY &&
    parsed.AZURE_OPENAI_API_VERSION &&
    parsed.AZURE_OPENAI_DEPLOYMENT;
  const azureOpenAI = azureConfigured
    ? {
        endpoint: parsed.AZURE_OPENAI_ENDPOINT!,
        apiKey: parsed.AZURE_OPENAI_API_KEY!,
        apiVersion: parsed.AZURE_OPENAI_API_VERSION!,
        deployment: parsed.AZURE_OPENAI_DEPLOYMENT!,
        policyId: parsed.AZURE_OPENAI_POLICY_ID,
        chatTimeoutMs:
          parsed.AZURE_OPENAI_CHAT_TIMEOUT_MS ?? DEFAULT_AZURE_OPENAI_CHAT_TIMEOUT_MS,
      }
    : undefined;

  return {
    azureOpenAI,
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
      providerLogPath:
        parsed.MCORCH_AI_PROVIDER_LOG ?? "logs/ai-provider.log",
      designLoopLogPath: parsed.MCORCH_DESIGN_LOOP_LOG ?? "logs/design-loop.log",
      designLoopMaxTurns: parsed.MCORCH_DESIGN_LOOP_MAX_TURNS ?? 10,
    },
  };
}
