import type { MergeQueuePr, PrFilterStatus } from '../types/mergeQueue.js';

/**
 * Derive a PR's filter status from its mergeability and check status.
 *
 * Priority: a PR is "pending" if ANY signal is still unknown (checks pending
 * or mergeable not yet computed by GitHub). Only once all signals are resolved
 * and at least one is negative does the PR become "blocked". This avoids
 * prematurely labelling a PR as blocked while GitHub is still computing.
 */
export function getPrStatus(pr: MergeQueuePr): PrFilterStatus {
  if (pr.mergeable === true && pr.checksStatus === 'success') return 'mergeable';
  if (pr.checksStatus === 'pending' || pr.mergeable === null) return 'pending';
  return 'blocked';
}
