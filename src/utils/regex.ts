/**
 * Escapes all regex special characters in a literal string so it can be safely
 * embedded inside a `RegExp` constructor without unintended pattern behaviour.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
