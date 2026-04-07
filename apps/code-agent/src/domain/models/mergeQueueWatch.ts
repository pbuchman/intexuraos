import type { Timestamp } from '@google-cloud/firestore';

export type MergeQueueWatchStatus = 'active' | 'drained' | 'cancelled';

export type SkipReason = 'merge_conflict' | 'checks_failing' | 'checks_pending' | 'mergeability_unknown' | 'not_eligible_author';

export interface MergedPr {
  prNumber: number;
  title: string;
  author: string;
  mergedAt: Timestamp;
}

export interface SkippedPr {
  prNumber: number;
  reason: SkipReason;
}

export interface MergeQueueWatch {
  id: string;
  userId: string;
  gitHubUsername: string;
  owner: string;
  repo: string;
  baseBranch: string;
  status: MergeQueueWatchStatus;
  mergedPrs: MergedPr[];
  skippedPrs: SkippedPr[];
  lastError: string | null;
  lastErrorAt: Timestamp | null;
  createdAt: Timestamp;
  lastTickAt: Timestamp | null;
  drainedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
  excludedPrNumbers: number[];
}
