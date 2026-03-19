/**
 * Shared utility functions for research and synthesis prompt builders.
 */

/**
 * Filter items by user exclusions using case-insensitive substring matching.
 * Returns the original array unchanged if no exclusions are provided.
 */
export function filterByExclusions(items: string[], exclusions: string[]): string[] {
  if (exclusions.length === 0) return items;
  return items.filter(
    (item) => !exclusions.some((excl) => item.toLowerCase().includes(excl.toLowerCase()))
  );
}

/**
 * Extract user exclusions from a safety object defensively.
 * Handles both typed SafetyInfo (with user_exclusions) and legacy objects without it.
 */
export function extractUserExclusions(safety: { user_exclusions?: string[] }): string[] {
  /* v8 ignore start -- schema: user_exclusions is always present after Zod parse with transform, in-guard is defensive for raw JS callers @preserve */
  return 'user_exclusions' in safety
    ? ((safety as { user_exclusions?: string[] }).user_exclusions ?? [])
    : [];
  /* v8 ignore stop @preserve */
}
