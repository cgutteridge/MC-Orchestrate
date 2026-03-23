import { appendFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import type { ChatCompletionOptions, ChatMessage, ChatProvider } from "./types.js";
import { DEFAULT_AZURE_OPENAI_CHAT_TIMEOUT_MS } from "../../config/env.js";
import {
  chatMessagesToResponsesInput,
  extractAssistantTextFromResponsesPayload,
} from "./azureResponsesParser.js";
import { extractJsonValue, parseJsonStrict } from "./json.js";

type AzureChatCompletionPayload = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  error?: { message?: string; code?: string | string[]; type?: string };
};

type AzureStreamChunk = {
  error?: { message?: string };
  choices?: Array<{
    delta?: { content?: string; role?: string };
    message?: { content?: string };
  }>;
};

/**
 * @returns True when `err` is a fetch/undici abort (including {@link DOMException} in Node).
 */
function isAbortError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") {
    return true;
  }
  if (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "AbortError"
  ) {
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
 * Reads an Azure OpenAI chat-completions **streaming** response (`text/event-stream`)
 * and concatenates `choices[0].delta.content` fragments.
 */
async function readChatCompletionStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Azure OpenAI chat (stream): empty response body");
  }
  const decoder = new TextDecoder();
  let carry = "";
  let content = "";

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith(":")) {
      return;
    }
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") {
      return;
    }
    let j: AzureStreamChunk;
    try {
      j = JSON.parse(data) as AzureStreamChunk;
    } catch {
      return;
    }
    if (j.error?.message) {
      throw new Error(`Azure OpenAI stream error: ${j.error.message}`);
    }
    const delta = j.choices?.[0]?.delta;
    const c = delta?.content;
    if (typeof c === "string" && c.length > 0) {
      content += c;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      carry += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = carry.indexOf("\n")) >= 0) {
        const line = carry.slice(0, nl);
        carry = carry.slice(nl + 1);
        handleLine(line);
      }
    }
    carry += decoder.decode();
    for (const line of carry.split("\n")) {
      handleLine(line);
    }
  } finally {
    reader.releaseLock();
  }

  if (content.length === 0) {
    throw new Error("Azure OpenAI chat (stream): empty assistant content after stream");
  }
  return content;
}

/**
 * Minimal Azure OpenAI chat client wrapper used by the planner.
 * Prefers the Responses API (`/openai/v1/responses`) when enabled; falls back to Chat Completions
 * when `useResponses` is false.
 */
export class AzureOpenAIChatProvider implements ChatProvider {
  public readonly name = "azure-openai";

  /**
   * @param chatTimeoutMs Abort the HTTP request after this many milliseconds (model latency + network).
   * @param chatStream When true, request `stream: true` on **Chat Completions** so headers return before the full completion is buffered. Ignored when `useResponses` is true.
   * @param useResponses When true (default), call `POST .../openai/v1/responses` instead of chat completions.
   * @param responsesApiVersion `api-version` query parameter for the Responses route (often `preview` on Azure).
   */
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly apiVersion: string,
    private readonly deployment: string,
    private readonly chatTimeoutMs: number,
    private readonly chatStream: boolean,
    private readonly useResponses: boolean,
    private readonly responsesApiVersion: string,
    private readonly logPath?: string,
    private readonly contentFilterPolicyId?: string,
  ) {}

  /**
   * Sends the planner message set to Azure OpenAI and returns the raw assistant content.
   */
  async chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const { signal, clear } = createTimeoutSignal(this.chatTimeoutMs);
    const t0 = performance.now();

    try {
      if (this.useResponses) {
        return await this.chatViaResponses(messages, options, signal, t0);
      }
      return await this.chatViaChatCompletions(messages, options, signal, t0);
    } catch (err) {
      if (isAbortError(err)) {
        throw new Error(
          `Azure OpenAI chat timed out after ${this.chatTimeoutMs}ms. ` +
            `Set AZURE_OPENAI_CHAT_TIMEOUT_MS to a higher value (default ${DEFAULT_AZURE_OPENAI_CHAT_TIMEOUT_MS}ms ≈ 15 min; max 3600000). ` +
            `For Chat Completions, streaming is on by default (AZURE_OPENAI_CHAT_STREAM); set MCORCH_AI_CHAT_DEBUG=1 for timings.`,
          { cause: err },
        );
      }
      throw err;
    } finally {
      clear?.();
    }
  }

  /**
   * Calls Azure OpenAI Responses API (non-streaming JSON body).
   */
  private async chatViaResponses(
    messages: ChatMessage[],
    options: ChatCompletionOptions | undefined,
    signal: AbortSignal,
    t0: number,
  ): Promise<string> {
    const base = this.endpoint.replace(/\/+$/, "");
    const url = `${base}/openai/v1/responses?api-version=${encodeURIComponent(this.responsesApiVersion)}`;
    const temperature = options?.temperature ?? 0.2;
    const body: Record<string, unknown> = {
      model: this.deployment,
      input: chatMessagesToResponsesInput(messages),
      temperature,
      store: false,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "api-key": this.apiKey,
    };

    const policyId = options?.contentFilterPolicyId ?? this.contentFilterPolicyId;
    if (policyId) {
      headers["x-policy-id"] = policyId;
    }

    chatDebugLog(`POST ${url} (Responses API, timeout ${this.chatTimeoutMs}ms)`);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    chatDebugLog(
      `status ${response.status} after ${Math.round(performance.now() - t0)}ms (headers)`,
    );

    const text = await response.text();
    chatDebugLog(`body ${text.length} bytes after ${Math.round(performance.now() - t0)}ms`);

    if (this.logPath) {
      await this.appendLog(url, body, response.status, text);
    }

    if (!response.ok) {
      let detail = text;
      try {
        const errPayload = JSON.parse(text) as { error?: { message?: string } };
        if (errPayload.error?.message) {
          detail = `${text} (message: ${errPayload.error.message})`;
        }
      } catch {
        // keep raw body
      }
      throw new Error(
        `Azure OpenAI Responses API failed: ${response.status} ${detail}. ` +
          `If your resource does not expose Responses yet, set AZURE_OPENAI_USE_RESPONSES=false to use Chat Completions.`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (err) {
      const preview = text.slice(0, 400);
      throw new Error(
        `Azure OpenAI Responses returned non-JSON (check endpoint, api-version, and deployment). Body preview: ${preview}`,
        { cause: err },
      );
    }

    return extractAssistantTextFromResponsesPayload(parsed);
  }

  /**
   * Legacy Chat Completions path (optionally streamed).
   */
  private async chatViaChatCompletions(
    messages: ChatMessage[],
    options: ChatCompletionOptions | undefined,
    signal: AbortSignal,
    t0: number,
  ): Promise<string> {
    const url = `${this.endpoint.replace(/\/+$/, "")}/openai/deployments/${this.deployment}/chat/completions?api-version=${this.apiVersion}`;
    const temperature = options?.temperature ?? 0.2;
    const body: Record<string, unknown> = {
      messages,
      temperature,
    };
    if (this.chatStream) {
      body.stream = true;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "api-key": this.apiKey,
    };

    const policyId = options?.contentFilterPolicyId ?? this.contentFilterPolicyId;
    if (policyId) {
      headers["x-policy-id"] = policyId;
    }

    chatDebugLog(`POST ${url} (timeout ${this.chatTimeoutMs}ms, stream=${this.chatStream})`);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    chatDebugLog(
      `status ${response.status} after ${Math.round(performance.now() - t0)}ms (headers)`,
    );

    if (!response.ok) {
      const errText = await response.text();
      if (this.logPath) {
        await this.appendLog(url, body, response.status, errText);
      }
      let detail = errText;
      try {
        const errPayload = JSON.parse(errText) as AzureChatCompletionPayload;
        if (errPayload.error?.message) {
          detail = `${errText} (message: ${errPayload.error.message})`;
        }
      } catch {
        // keep raw body
      }
      throw new Error(`Azure OpenAI chat failed: ${response.status} ${detail}`);
    }

    let assistantText: string;
    if (this.chatStream) {
      assistantText = await readChatCompletionStream(response);
      chatDebugLog(
        `stream done ${assistantText.length} chars after ${Math.round(performance.now() - t0)}ms`,
      );
    } else {
      const text = await response.text();
      chatDebugLog(`body ${text.length} bytes after ${Math.round(performance.now() - t0)}ms`);

      if (this.logPath) {
        await this.appendLog(url, body, response.status, text);
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

      assistantText = extractAssistantContent(parsed);
    }

    if (this.logPath && this.chatStream) {
      await this.appendLog(url, body, response.status, assistantText);
    }

    return assistantText;
  }

  private async appendLog(
    url: string,
    body: Record<string, unknown>,
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
      const parsed = JSON.parse(responseText) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("not object");
      }
      const p = parsed as Record<string, unknown>;
      if (Array.isArray(p.choices)) {
        const payload = parsed as AzureChatCompletionPayload;
        const content = payload.choices?.[0]?.message?.content;
        if (content) {
          const jsonText = extractJsonValue(content);
          if (jsonText) {
            contentPreview = JSON.stringify(parseJsonStrict(jsonText), null, 2);
          } else {
            contentPreview = content;
          }
        }
      } else if (p.output !== undefined || typeof p.output_text === "string") {
        const assistantRaw = extractAssistantTextFromResponsesPayload(parsed);
        const jsonText = extractJsonValue(assistantRaw);
        if (jsonText) {
          contentPreview = JSON.stringify(parseJsonStrict(jsonText), null, 2);
        } else {
          contentPreview = assistantRaw;
        }
      }
    } catch {
      // Keep raw response on parse failure (streaming stores plain assistant text).
      try {
        const jsonText = extractJsonValue(responseText);
        if (jsonText) {
          contentPreview = JSON.stringify(parseJsonStrict(jsonText), null, 2);
        }
      } catch {
        // keep raw
      }
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
