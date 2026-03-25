/**
 * GitHub Pull Request Summary domain model.
 *
 * One document per unique PR, upserted on every webhook event.
 * Used for the 30-day list view — O(PRs) instead of O(events).
 */

export interface GitHubPRSummary {
  repository: string;
  pullRequestNumber: number;
  title: string | null;
  state: string | null; // 'open' | 'closed' from GitHub
  mergedAt: Date | null;
  baseBranch: string | null;
  authorLogin: string | null;
  headBranch: string | null;
  mergeConflictStatus: 'clean' | 'conflicting' | 'unknown' | null;
  lastConflictCheckedAt: Date | null;
  conflictEpisodeStartedAt: Date | null;
  conflictResolvedAt: Date | null;
  managedConflictCommentId: number | null;
  managedConflictTaskId: string | null;
  managedConflictTaskOwnerUserId: string | null;
  lastActivityAt: Date;
  firstSeenAt: Date;
  lastReviewedCommitSha: string | null;  // HEAD SHA at last review completion
}

/**
 * Input for upserting a PR summary.
 * title/state/mergedAt are only present for pull_request events.
 */
export interface UpsertGitHubPRSummaryInput {
  repository: string;
  pullRequestNumber: number;
  lastActivityAt: Date;
  firstSeenAt: Date;
  // Only present for pull_request events (not review/comment events)
  title?: string | null;
  state?: string | null;
  mergedAt?: Date | null;
  baseBranch?: string | null;
  authorLogin?: string | null;
  headBranch?: string | null;
  mergeConflictStatus?: 'clean' | 'conflicting' | 'unknown' | null;
  lastConflictCheckedAt?: Date | null;
  conflictEpisodeStartedAt?: Date | null;
  conflictResolvedAt?: Date | null;
  managedConflictCommentId?: number | null;
  managedConflictTaskId?: string | null;
  managedConflictTaskOwnerUserId?: string | null;
  lastReviewedCommitSha?: string | null;  // HEAD SHA at last review completion
}
