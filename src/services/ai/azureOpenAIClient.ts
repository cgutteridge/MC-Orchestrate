import { appendFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type {
  ChatCompletionOptions,
  ChatMessage,
  ChatProvider,
} from "./types.js";
import { DEFAULT_AZURE_OPENAI_CHAT_TIMEOUT_MS } from "../../config/env.js";
import { extractJsonValue, parseJsonStrict } from "./json.js";

type AzureChatCompletionPayload = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  error?: { message?: string; code?: string | string[]; type?: string };
};

/**
 * @returns True when `err` is a fetch/undici abort (including {@link DOMException} in Node).
 */
function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") {
    return true;
  }
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  return false;
}

function chatDebugEnabled(): boolean {
  return process.env.MCORCH_AI_CHAT_DEBUG === "1" || process.env.MCORCH_AI_CHAT_DEBUG === "true";
}

function chatDebugLog(message: string): void {
  if (chatDebugEnabled()) {
    process.stderr.write(`[azure-openai] ${message}\n`);
  }
}

/**
 * Builds an {@link AbortSignal} that aborts after `ms`, with cleanup when the fallback
 * timer is used (Node without {@link AbortSignal.timeout}).
 */
function createTimeoutSignal(ms: number): { signal: AbortSignal; clear?: () => void } {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(ms) };
  }
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return {
    signal: c.signal,
    clear: () => clearTimeout(t),
  };
}

function extractAssistantContent(payload: AzureChatCompletionPayload): string {
  const choice0 = payload.choices?.[0];
  const msg = choice0?.message;
  const content = msg?.content;
  if (typeof content === "string" && content.length > 0) {
    return content;
  }
  const finish = choice0?.finish_reason ?? "unknown";
  const refusal = msg?.refusal;
  const parts = [
    "Azure OpenAI chat returned no assistant text.",
    `finish_reason=${JSON.stringify(finish)}`,
  ];
  if (refusal) {
    parts.push(`refusal=${JSON.stringify(refusal)}`);
  }
  if (payload.error?.message) {
    parts.push(`api_error=${JSON.stringify(payload.error.message)}`);
  }
  throw new Error(parts.join(" "));
}

/**
 * Minimal Azure OpenAI chat client wrapper used by the planner.
 */
export class AzureOpenAIChatProvider implements ChatProvider {
  public readonly name = "azure-openai";

  /**
   * @param chatTimeoutMs Abort the HTTP request after this many milliseconds (model latency + network).
   */
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly apiVersion: string,
    private readonly deployment: string,
    private readonly chatTimeoutMs: number,
    private readonly logPath?: string,
    private readonly contentFilterPolicyId?: string,
  ) {}

  /**
   * Sends the planner message set to Azure OpenAI and returns the raw assistant content.
   */
  async chat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<string> {
    const url = `${this.endpoint.replace(/\/+$/, "")}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
    const body = {
      messages,
      temperature: options?.temperature ?? 0.2,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "api-key": this.apiKey,
    };

    const policyId =
      options?.contentFilterPolicyId ?? this.contentFilterPolicyId;
    if (policyId) {
      headers["x-policy-id"] = policyId;
    }

    const { signal, clear } = createTimeoutSignal(this.chatTimeoutMs);
    const t0 = performance.now();

    try {
      chatDebugLog(`POST ${url} (timeout ${this.chatTimeoutMs}ms)`);
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
      chatDebugLog(`status ${response.status} after ${Math.round(performance.now() - t0)}ms (headers)`);

      const text = await response.text();
      chatDebugLog(`body ${text.length} bytes after ${Math.round(performance.now() - t0)}ms`);

      if (this.logPath) {
        await this.appendLog(url, body, response.status, text);
      }

      if (!response.ok) {
        let detail = text;
        try {
          const errPayload = JSON.parse(text) as AzureChatCompletionPayload;
          if (errPayload.error?.message) {
            detail = `${text} (message: ${errPayload.error.message})`;
          }
        } catch {
          // keep raw body
        }
        throw new Error(`Azure OpenAI chat failed: ${response.status} ${detail}`);
      }

      let parsed: AzureChatCompletionPayload;
      try {
        parsed = JSON.parse(text) as AzureChatCompletionPayload;
      } catch (err) {
        const preview = text.slice(0, 400);
        throw new Error(
          `Azure OpenAI returned non-JSON (check endpoint, api-version, and deployment). Body preview: ${preview}`,
          { cause: err },
        );
      }

      return extractAssistantContent(parsed);
    } catch (err) {
      if (isAbortError(err)) {
        throw new Error(
          `Azure OpenAI chat timed out after ${this.chatTimeoutMs}ms (upload + model + full response body). ` +
            `If this persists: set AZURE_OPENAI_CHAT_TIMEOUT_MS higher (default ${DEFAULT_AZURE_OPENAI_CHAT_TIMEOUT_MS}ms). ` +
            `Confirm AZURE_OPENAI_ENDPOINT is https://<resource>.openai.azure.com (Azure resource, not api.openai.com), ` +
            `deployment name matches the portal, and run with MCORCH_AI_CHAT_DEBUG=1 to log timings.`,
          { cause: err },
        );
      }
      throw err;
    } finally {
      clear?.();
    }
  }

  private async appendLog(
    url: string,
    body: { messages: ChatMessage[]; temperature: number },
    status: number,
    responseText: string,
  ): Promise<void> {
    if (!this.logPath) {
      return;
    }

    const dir = this.logPath.includes("/")
      ? this.logPath.slice(0, this.logPath.lastIndexOf("/"))
      : ".";
    await mkdir(dir, { recursive: true });

    let contentPreview = responseText;
    try {
      const parsed = JSON.parse(responseText) as AzureChatCompletionPayload;
      const content = parsed.choices?.[0]?.message?.content;
      if (content) {
        const jsonText = extractJsonValue(content);
        if (jsonText) {
          contentPreview = JSON.stringify(parseJsonStrict(jsonText), null, 2);
        } else {
          contentPreview = content;
        }
      }
    } catch {
      // Keep raw response on parse failure.
    }

    const entry = [
      "",
      `=== ${new Date().toISOString()} ===`,
      `POST ${url}`,
      JSON.stringify(body, null, 2),
      `STATUS ${status}`,
      contentPreview,
      "---",
    ].join("\n");
    await appendFile(this.logPath, entry, "utf8");
  }
}

