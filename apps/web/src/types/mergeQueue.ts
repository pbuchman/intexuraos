export interface MergeQueueBranch {
  name: string;
  openPrCount: number;
}

export interface MergeQueuePr {
  number: number;
  title: string;
  author: string | null;
  authorIsEligible: boolean;
  mergeConflictStatus: 'clean' | 'conflicting' | 'unknown' | null;
  createdAt: string;
  htmlUrl: string;
}

export type PrFilterStatus = 'mergeable' | 'pending' | 'blocked';

export interface MergedPrEntry {
  prNumber: number;
  title: string;
  author: string;
  mergedAt: string;
}

export type SkipReason = 'merge_conflict' | 'checks_failing' | 'checks_pending' | 'mergeability_unknown' | 'not_eligible_author';

export interface SkippedPrEntry {
  prNumber: number;
  reason: SkipReason;
}

export type WatchStatus = 'active' | 'drained' | 'cancelled';

export interface MergeQueueWatch {
  watchId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  status: WatchStatus;
  mergedPrs: MergedPrEntry[];
  skippedPrs: SkippedPrEntry[];
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  lastTickAt: string | null;
  drainedAt: string | null;
}
