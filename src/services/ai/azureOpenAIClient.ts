import { appendFile, mkdir } from "node:fs/promises";
import type {
  ChatCompletionOptions,
  ChatMessage,
  ChatProvider,
} from "./types.js";
import { extractJsonValue, parseJsonStrict } from "./json.js";

export class AzureOpenAIChatProvider implements ChatProvider {
  public readonly name = "azure-openai";
  private readonly timeoutMs = 20000;

  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly apiVersion: string,
    private readonly deployment: string,
    private readonly debug = false,
    private readonly logPath?: string,
    private readonly contentFilterPolicyId?: string,
  ) {}

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();

      if (this.debug) {
        process.stderr.write(`[debug] ${response.status} ${text}\n`);
      }
      if (this.logPath) {
        await this.appendLog(url, body, response.status, text);
      }

      if (!response.ok) {
        throw new Error(`Azure OpenAI chat failed: ${response.status} ${text}`);
      }

      const parsed = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("Azure OpenAI chat returned no content");
      }
      return content;
    } finally {
      clearTimeout(timeout);
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
      const parsed = JSON.parse(responseText) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
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
