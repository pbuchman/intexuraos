import type { MergeQueuePr, MergeQueueWatch, PrFilterStatus } from '../types/mergeQueue.js';

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

/**
 * Select the most relevant watch for a branch.
 *
 * Priority: active > most-recent drained/cancelled (by createdAt).
 */
export function selectCurrentWatch(
  watches: readonly MergeQueueWatch[],
  selectedBranch: string | null,
): MergeQueueWatch | null {
  if (selectedBranch === null) return null;
  const branchWatches = watches.filter((w) => w.baseBranch === selectedBranch);
  return branchWatches.find((w) => w.status === 'active')
    ?? branchWatches
        .filter((w) => w.status === 'drained' || w.status === 'cancelled')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    ?? null;
}
