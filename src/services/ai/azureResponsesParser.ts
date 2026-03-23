import type { ChatMessage } from "./types.js";

/**
 * Maps planner {@link ChatMessage} history to Azure OpenAI Responses API `input`.
 * Uses plain string `content` per turn (supported by the Responses API input list).
 *
 * @param messages System, user, and assistant turns from placement-then-build planning.
 */
export function chatMessagesToResponsesInput(
  messages: ChatMessage[],
): Array<{ role: string; content: string }> {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Extracts concatenated assistant text from a Responses API JSON body.
 * Handles `output_text` (when present) and `output[]` items of type `message`
 * with `output_text` blocks.
 *
 * @param payload Parsed JSON from `POST .../openai/v1/responses`.
 * @returns Raw assistant string (expected to contain JSON for the planner).
 */
export function extractAssistantTextFromResponsesPayload(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Azure Responses: empty or invalid JSON body");
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.error === "object" && p.error !== null) {
    const msg = (p.error as { message?: string }).message;
    throw new Error(`Azure Responses API error: ${msg ?? JSON.stringify(p.error)}`);
  }
  if (typeof p.output_text === "string" && p.output_text.length > 0) {
    return p.output_text;
  }
  const output = p.output;
  if (!Array.isArray(output)) {
    throw new Error(
      `Azure Responses: missing output array. Keys: ${Object.keys(p).sort().join(", ")}`,
    );
  }
  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const it = item as Record<string, unknown>;
    if (it.type !== "message") {
      continue;
    }
    const content = it.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;
      if (b.type === "output_text" && typeof b.text === "string") {
        parts.push(b.text);
      }
    }
  }
  const joined = parts.join("");
  if (joined.length === 0) {
    throw new Error(`Azure Responses: no assistant text in output (${output.length} output items)`);
  }
  return joined;
}
