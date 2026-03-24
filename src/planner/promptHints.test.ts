import { describe, expect, it } from "vitest";
import type { ChatCommandRequest } from "../types/plugin.js";
import {
  buildPromptMatchText,
  collectPromptHints,
  formatPromptHintsSection,
  keywordMatchesRequestText,
  type PromptHint,
} from "./promptHints.js";

function minimalRequest(overrides: Partial<ChatCommandRequest>): ChatCommandRequest {
  return {
    requestId: "r1",
    player: {
      uuid: "u",
      name: "p",
      world: "world",
      position: { x: 0, y: 64, z: 0 },
      yaw: 0,
      pitch: 0,
      lookVector: { x: 0, y: 0, z: -1 },
    },
    message: "",
    recentMessages: [],
    localContext: {
      nearbyBlocks: [],
      nearbyEntities: [],
      nearbyPlayers: [],
    },
    serverContext: {
      timestamp: "2020-01-01T00:00:00.000Z",
      dimension: "minecraft:overworld",
      onlinePlayerCount: 1,
    },
    initialScanRegion: {
      minX: -8,
      minY: 60,
      minZ: -8,
      maxX: 8,
      maxY: 70,
      maxZ: 8,
    },
    ...overrides,
  };
}

describe("buildPromptMatchText", () => {
  it("uses the current message only for keyword matching", () => {
    const r = minimalRequest({
      message: "hello",
      recentMessages: ["moat", "tower"],
    });
    expect(buildPromptMatchText(r)).toBe("hello");
    expect(buildPromptMatchText(r)).not.toContain("moat");
  });
});

describe("keywordMatchesRequestText", () => {
  it("matches multi-word phrases as substring", () => {
    expect(keywordMatchesRequestText("dig a deep water trench here", "water trench")).toBe(true);
  });

  it("does not match short tokens inside unrelated words", () => {
    expect(keywordMatchesRequestText("cathedral", "at")).toBe(false);
  });

  it("matches moat inside moats via includes fallback", () => {
    expect(keywordMatchesRequestText("wide moats around", "moat")).toBe(true);
  });
});

describe("collectPromptHints", () => {
  const customHints: readonly PromptHint[] = [
    { keywords: ["alpha"], hint: "first hint" },
    { keywords: ["beta"], hint: "second hint" },
    { keywords: ["gamma"], hint: "third only if gamma" },
  ];

  it("returns hints in file order when multiple match", () => {
    const r = minimalRequest({ message: "alpha and beta together" });
    expect(collectPromptHints(r, customHints)).toEqual(["first hint", "second hint"]);
  });

  it("deduplicates identical hint bodies", () => {
    const dup: readonly PromptHint[] = [
      { keywords: ["x"], hint: "same" },
      { keywords: ["y"], hint: "same" },
    ];
    const r = minimalRequest({ message: "x y" });
    expect(collectPromptHints(r, dup)).toEqual(["same"]);
  });

  it("matches keywords only in the current message, not recentMessages", () => {
    const r = minimalRequest({ message: "use a moat here", recentMessages: ["ignored line"] });
    const hints = collectPromptHints(r);
    expect(hints.some((h) => h.includes("Moats and trenches"))).toBe(true);
  });

  it("matches ship-related keywords from DEFAULT_PROMPT_HINTS", () => {
    const r = minimalRequest({ message: "build a spruce ship" });
    const hints = collectPromptHints(r);
    expect(hints.some((h) => h.includes("Ships and boats"))).toBe(true);
  });

  it("returns empty when nothing matches", () => {
    const r = minimalRequest({ message: "plain stone box" });
    expect(collectPromptHints(r, customHints)).toEqual([]);
  });
});

describe("formatPromptHintsSection", () => {
  it("returns undefined for empty", () => {
    expect(formatPromptHintsSection([])).toBeUndefined();
  });

  it("wraps paragraphs with header", () => {
    const s = formatPromptHintsSection(["one", "two"]);
    expect(s).toContain("CONTEXTUAL HINTS");
    expect(s).toContain("one");
    expect(s).toContain("two");
  });
});
