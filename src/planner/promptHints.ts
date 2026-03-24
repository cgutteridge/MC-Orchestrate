import type { ChatCommandRequest } from "../types/plugin.js";
import { escapeRegex } from "../utils/regex.js";

/**
 * One conditional system-prompt fragment. If any {@link PromptHint.keywords}
 * matches the current request text, {@link PromptHint.hint} is appended (once).
 */
export type PromptHint = {
  /** Case-insensitive; multi-word phrases use substring match, single tokens use word boundaries when possible. */
  keywords: readonly string[];
  /** Short paragraph appended to the system prompt when this hint fires. */
  hint: string;
};

/**
 * Default keyword-triggered hints. Edit this list to add special-case guidance
 * without growing the base system prompt for every request.
 */
export const DEFAULT_PROMPT_HINTS: readonly PromptHint[] = [
  {
    keywords: ["moat", "trench", "ditch"],
    hint:
      "Moats and trenches: do not use one giant horizontal slab of water across the whole footprint — that reads as a flat pool. " +
      "Separate the trench (water or `_`) from the inner keep with an **orthogonal** plan: **straight walls and corners** — a rectangular channel around a rectangular courtyard. " +
      "Do **not** model the whole castle as a flat circular disk or bullseye; round moats are rare unless the player asked for round or circular.",
  },
  {
    keywords: ["battlement", "crenellat", "merlon", "parapet"],
    hint: "Battlements: model crenellations with alternating solid blocks and gaps (air or lower wall segments) along the wall top, not a solid slab unless the player asked for a flat roof only.",
  },
  {
    keywords: ["ship", "boat", "vessel", "galley", "hull", "sailboat", "schooner"],
    hint: "Ships and boats: never use a single horizontal slice — you need many `layers` (keel, hull sides rising toward the deck, then deck and superstructure). In **plan view** (looking down at each slice), the hull should read as a long narrow shape along one axis (bow toward one end), not a square blob; mirror left/right often helps. Use water or `_` (air) around the hull in the grid so the outline is visible. Prefer planks, stairs, and stripped logs for wood ships.",
  },
];

/**
 * Builds text for keyword matching (current message only).
 *
 * @param request The validated plugin request for this chat turn.
 * @returns Lowercase text for matching.
 */
export function buildPromptMatchText(request: ChatCommandRequest): string {
  return request.message.toLowerCase();
}

/**
 * Returns true when `keyword` matches `text` (already lowercased is OK).
 * Multi-word keywords use substring match; single-word tokens use a word-boundary
 * regex so short tokens do not match inside unrelated words.
 *
 * @param text Haystack (typically lowercased).
 * @param keyword Keyword or short phrase from a {@link PromptHint}.
 */
export function keywordMatchesRequestText(text: string, keyword: string): boolean {
  const k = keyword.trim().toLowerCase();
  if (k.length === 0) {
    return false;
  }
  const t = text.toLowerCase();
  if (k.includes(" ")) {
    return t.includes(k);
  }
  if (k.length <= 2) {
    return new RegExp(`\\b${escapeRegex(k)}\\b`, "i").test(t);
  }
  if (new RegExp(`\\b${escapeRegex(k)}\\b`, "i").test(t)) {
    return true;
  }
  return t.includes(k);
}

/**
 * Collects {@link PromptHint.hint} strings for every hint whose keywords match
 * `request`. Each distinct `hint` body is included at most once, in list order.
 *
 * @param request Current chat command request.
 * @param hints Hint list to scan (defaults to {@link DEFAULT_PROMPT_HINTS}).
 * @returns Ordered hint paragraphs to append to the system prompt.
 */
export function collectPromptHints(
  request: ChatCommandRequest,
  hints: readonly PromptHint[] = DEFAULT_PROMPT_HINTS,
): string[] {
  const text = buildPromptMatchText(request);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of hints) {
    const hit = entry.keywords.some((kw) => keywordMatchesRequestText(text, kw));
    if (!hit) {
      continue;
    }
    const h = entry.hint.trim();
    if (h.length === 0 || seen.has(h)) {
      continue;
    }
    seen.add(h);
    out.push(h);
  }
  return out;
}

/**
 * Formats matched hints for appending to the system prompt, or `undefined` when empty.
 *
 * @param hintParagraphs Strings from {@link collectPromptHints}.
 */
export function formatPromptHintsSection(hintParagraphs: string[]): string | undefined {
  if (hintParagraphs.length === 0) {
    return undefined;
  }
  return [
    "=== CONTEXTUAL HINTS (matched keywords in this request) ===",
    "",
    ...hintParagraphs.map((p) => p.trim()),
  ].join("\n");
}
