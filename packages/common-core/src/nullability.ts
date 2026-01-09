/**
 * Null safety utilities for consistent handling of nullable values.
 *
 * These utilities help reduce boilerplate and improve type narrowing
 * for common null-handling patterns across the codebase.
 */

/**
 * Ensures all values in an array are defined (not null/undefined).
 * Useful for validating results from Promise.all() calls.
 *
 * @throws Error if any value is null or undefined
 *
 * @example
 * const [google, openai] = await Promise.all([fetchGoogle(), fetchOpenai()]);
 * const providers = ensureAllDefined([google, openai], ['google', 'openai']);
 * // providers is now T[] with all nulls removed
 */
export function ensureAllDefined<T>(
  values: readonly (T | null | undefined)[],
  fieldNames: readonly string[]
): T[] {
  const missing = fieldNames.filter((_, i) => values[i] === null || values[i] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required values: ${missing.join(', ')}`);
  }
  return values as T[];
}

/**
 * Safely gets the first element of an array, returning null if empty.
 * Better than array[0] for type-safe access with noUncheckedIndexedAccess.
 *
 * @example
 * const doc = getFirstOrNull(snapshot.docs);
 * if (doc === null) return { ok: true, value: null };
 */
export function getFirstOrNull<T>(arr: readonly T[]): T | null {
  return arr[0] ?? null;
}

/**
 * Converts an ISO string to a Date, handling null values.
 *
 * @example
 * const createdAt = toDateOrNull(doc.createdAt);
 */
export function toDateOrNull(isoString: string | null | undefined): Date | null {
  if (isoString === null || isoString === undefined) {
    return null;
  }
  return new Date(isoString);
}

/**
 * Converts a Date to an ISO string, handling null values.
 *
 * @example
 * const createdAtStr = toISOStringOrNull(bookmark.createdAt);
 */
export function toISOStringOrNull(date: Date | null | undefined): string | null {
  if (date === null || date === undefined) {
    return null;
  }
  return date.toISOString();
}
