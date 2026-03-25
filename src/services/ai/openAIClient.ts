import { appendFile, mkdir } from "node:fs/promises";
import { DEFAULT_AI_CHAT_TIMEOUT_MS } from "../../config/env.js";
import { extractJsonValue, parseJsonStrict } from "./json.js";
import type { ChatCompletionOptions, ChatMessage, ChatProvider } from "./types.js";

type OpenAIChatCompletionPayload = {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }>;
  error?: { message?: string; code?: string | null; type?: string };
};

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

function extractAssistantContent(payload: OpenAIChatCompletionPayload): string {
  const choice0 = payload.choices?.[0];
  const msg = choice0?.message;
  const content = msg?.content;
  if (typeof content === "string" && content.length > 0) {
    return content;
  }
  const finish = choice0?.finish_reason ?? "unknown";
  const refusal = msg?.refusal;
  const parts = [
    "OpenAI chat returned no assistant text.",
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

export class OpenAIChatProvider implements ChatProvider {
  public readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
    private readonly chatTimeoutMs: number,
    private readonly logPath?: string,
  ) {}

  async chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string> {
    const { signal, clear } = createTimeoutSignal(this.chatTimeoutMs);
    const url = `${this.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.2,
      reasoning_effort: "none",
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      const text = await response.text();

      if (this.logPath) {
        await this.appendLog(url, body, response.status, text);
      }

      if (!response.ok) {
        let detail = text;
        try {
          const errPayload = JSON.parse(text) as OpenAIChatCompletionPayload;
          if (errPayload.error?.message) {
            detail = `${text} (message: ${errPayload.error.message})`;
          }
        } catch {
          // keep raw body
        }
        throw new Error(`OpenAI chat failed: ${response.status} ${detail}`);
      }

      let parsed: OpenAIChatCompletionPayload;
      try {
        parsed = JSON.parse(text) as OpenAIChatCompletionPayload;
      } catch (err) {
        const preview = text.slice(0, 400);
        throw new Error(
          `OpenAI returned non-JSON (check OPENAI_MODEL / OPENAI_BASE_URL). Body preview: ${preview}`,
          { cause: err },
        );
      }

      return extractAssistantContent(parsed);
    } catch (err) {
      if (isAbortError(err)) {
        throw new Error(
          `OpenAI chat timed out after ${this.chatTimeoutMs}ms. ` +
            `Set OPENAI_CHAT_TIMEOUT_MS to a higher value (default ${DEFAULT_AI_CHAT_TIMEOUT_MS}ms ≈ 15 min; max 3600000).`,
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
      const parsed = JSON.parse(responseText) as OpenAIChatCompletionPayload;
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
