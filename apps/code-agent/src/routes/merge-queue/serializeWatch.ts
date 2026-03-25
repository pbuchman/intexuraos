import type { MergeQueueWatch } from '../../domain/models/mergeQueueWatch.js';

/** Convert a Firestore Timestamp, Date, or ISO string to ISO string, or null. */
export function tsToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'toDate' in value) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Serialize a MergeQueueWatch for the API response (Timestamps -> ISO strings, id -> watchId).
 *
 * Uses an explicit allowlist to strip internal fields from the response.
 * Intentionally omitted: userId, gitHubUsername, cancelledAt.
 */
export function serializeWatch(watch: MergeQueueWatch): Record<string, unknown> {
  return {
    watchId: watch.id,
    owner: watch.owner,
    repo: watch.repo,
    baseBranch: watch.baseBranch,
    status: watch.status,
    lastError: watch.lastError,
    createdAt: tsToIso(watch.createdAt),
    lastTickAt: tsToIso(watch.lastTickAt),
    lastErrorAt: tsToIso(watch.lastErrorAt),
    drainedAt: tsToIso(watch.drainedAt),
    skippedPrs: watch.skippedPrs,
    mergedPrs: watch.mergedPrs.map((pr) => ({
      prNumber: pr.prNumber,
      title: pr.title,
      author: pr.author,
      mergedAt: tsToIso(pr.mergedAt),
    })),
    excludedPrNumbers: watch.excludedPrNumbers,
  };
}
