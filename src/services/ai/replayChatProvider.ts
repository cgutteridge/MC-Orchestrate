import { z } from "zod";
import type { ChatCompletionOptions, ChatMessage, ChatProvider } from "./types.js";

/**
 * Serialized regression fixture: ordered assistant payloads exactly as returned
 * from {@link ChatProvider.chat} (typically raw model text containing JSON).
 */
export const ReplayFixtureSchema = z.object({
  version: z.literal(1),
  description: z.string().optional(),
  assistantTurns: z.array(z.string()).min(1),
});

export type ReplayFixture = z.infer<typeof ReplayFixtureSchema>;

/**
 * Parses a replay fixture from JSON (e.g. `benchmark/fixtures/azure-baseline/*.json`).
 *
 * @param raw Parsed JSON object from disk.
 * @returns Validated fixture, or throws if the shape is wrong.
 */
export function parseReplayFixture(raw: unknown): ReplayFixture {
  return ReplayFixtureSchema.parse(raw);
}

/**
 * Builds a {@link ChatProvider} that ignores incoming messages and returns a
 * fixed sequence of assistant strings. Used to replay captured Azure (or other)
 * traces in tests without network access.
 *
 * @param assistantTurns Raw assistant payloads, one per `chat()` invocation.
 */
export function createReplayChatProvider(assistantTurns: readonly string[]): ChatProvider {
  let index = 0;
  return {
    name: "replay",
    async chat(_messages: ChatMessage[], _options?: ChatCompletionOptions): Promise<string> {
      if (index >= assistantTurns.length) {
        throw new Error(
          `Replay provider exhausted at turn ${index} (only ${assistantTurns.length} assistant payload(s) recorded).`,
        );
      }
      return assistantTurns[index++]!;
    },
  };
}
