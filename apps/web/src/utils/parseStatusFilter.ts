/**
 * Parse a serialized status filter key back into a typed array.
 * Used by paginated hooks that serialize array options for stable dependency tracking.
 */
export function parseStatusFilter(statusKey: string): string[] | undefined {
  return statusKey !== '' ? statusKey.split(',') : undefined;
}
