import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

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
});

export type AppConfig = {
  azureOpenAI?: {
    endpoint: string;
    apiKey: string;
    apiVersion: string;
    deployment: string;
    policyId?: string;
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
  };
}
