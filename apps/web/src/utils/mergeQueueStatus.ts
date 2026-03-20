import type { MergeQueuePr, PrFilterStatus } from '@/types';

export function getPrStatus(pr: MergeQueuePr): PrFilterStatus {
  if (pr.mergeable === true && pr.checksStatus === 'success') return 'mergeable';
  if (pr.checksStatus === 'pending' || pr.mergeable === null) return 'pending';
  return 'blocked';
}
