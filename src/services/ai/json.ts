/**
 * Extracts the first plausible JSON object from raw model output.
 */
export function extractJsonValue(text: string): string | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

/**
 * Parses JSON without any coercion so callers keep explicit control of validation.
 */
export function parseJsonStrict<T>(text: string): T {
  return JSON.parse(text) as T;
}
