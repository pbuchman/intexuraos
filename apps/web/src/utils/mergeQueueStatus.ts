import type { MergeQueuePr, PrFilterStatus } from '../types/mergeQueue.js';

/**
 * Derive a PR's filter status from its merge conflict status.
 *
 * - 'clean' → mergeable (no conflicts detected)
 * - 'conflicting' → blocked (merge conflicts present)
 * - 'unknown' or null → pending (conflict status not yet determined)
 */
export function getPrStatus(pr: MergeQueuePr): PrFilterStatus {
  if (pr.mergeConflictStatus === 'clean') return 'mergeable';
  if (pr.mergeConflictStatus === 'conflicting') return 'blocked';
  return 'pending';
}
