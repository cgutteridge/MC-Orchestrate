import { describe, expect, it } from "vitest";
import {
  chatMessagesToResponsesInput,
  extractAssistantTextFromResponsesPayload,
} from "./azureResponsesParser.js";

describe("chatMessagesToResponsesInput", () => {
  it("maps roles and content", () => {
    expect(
      chatMessagesToResponsesInput([
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ]),
    ).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
  });
});

describe("extractAssistantTextFromResponsesPayload", () => {
  it("uses top-level output_text when present", () => {
    expect(extractAssistantTextFromResponsesPayload({ output_text: '{"action":"build"}' })).toBe(
      '{"action":"build"}',
    );
  });

  it("concatenates output_text blocks from message items", () => {
    expect(
      extractAssistantTextFromResponsesPayload({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: '{"action":' },
              { type: "output_text", text: '"build"}' },
            ],
          },
        ],
      }),
    ).toBe('{"action":"build"}');
  });

  it("throws on API error object", () => {
    expect(() =>
      extractAssistantTextFromResponsesPayload({
        error: { message: "bad" },
      }),
    ).toThrow(/bad/);
  });
});
