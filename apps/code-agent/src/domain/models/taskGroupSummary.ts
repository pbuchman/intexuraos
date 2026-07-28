import type { Timestamp } from '@google-cloud/firestore';
import type { GroupStatus } from '../issueGrouping/types.js';

/**
 * Aggregated summary for a (userId, linearIssueId) group of tasks.
 * One document per group; updated incrementally after task state changes.
 *
 * Collection: task_group_summaries
 * Document ID: `{userId}_{groupKey}`
 */
export interface TaskGroupSummary {
  userId: string;
  linearIssueId: string | null;
  linearIssueNumber: number | null;
  linearIssueSortKey: number;
  /** linearIssueId when present, otherwise `standalone_{taskId}` */
  groupKey: string;

  // Aggregate fields
  taskCount: number;
  /** Current displayable task ids used to make maintenance retries idempotent. */
  taskIds?: string[];
  taskStatusById?: Record<string, string>;
  taskLifecycleAtById?: Record<string, Timestamp>;
  /** Tasks with status in {queued, dispatched, running} */
  activeTaskCount: number;
  /** Newest attempt identity, ordered by createdAt then task id. Absent on legacy documents. */
  latestTaskId?: string;
  latestTaskCreatedAt?: Timestamp;
  latestTaskStatus: string;
  /** Indexed compatibility field containing latest lifecycle activity, not technical modification time. */
  latestTaskUpdatedAt: Timestamp;
  /** Tie-break owner for latestTaskUpdatedAt. Absent on legacy documents. */
  latestLifecycleTaskId?: string;
  agentTypesPresent: string[];
  hasCompletedPlanning: boolean;
  hasCompletedExecution: boolean;
  /** True when an execution-agent task (not pull_request) has completed. */
  hasCompletedExecutionAgent: boolean;
  hasImplementationTaskId: boolean;
  hasPrUrl: boolean;
  prNumber: number | null;
  latestMergeReadyEvidence?: boolean;
  latestMergeReadyReason?: string | null;
  latestMergeReadyUpdatedAt?: Timestamp | null;
  /** Latest merge-ready evidence or invalidation decision time. */
  latestMergeReadyDecisionAt?: Timestamp | null;
  latestMergeReadyDecisionTaskId?: string | null;
  prMergedAt?: Timestamp | null;
  prClosedAt?: Timestamp | null;
  latestReviewNeedsRemediation: boolean | null;
  latestReviewUpdatedAt?: Timestamp | null;
  latestReviewTaskId?: string | null;
  representativePrUpdatedAt?: Timestamp | null;
  representativePrTaskId?: string | null;

  // Sort key fields
  oldestTaskCreatedAt: Timestamp;
  mostRecentDispatchedAt: Timestamp | null;

  // Label flags from Linear (set via recomputeWithLabels, absent on legacy docs)
  hasImplementationReadyLabel?: boolean;
  hasMergeReadyLabel?: boolean;
  labelsUpdatedAt?: Timestamp;

  // User-set flags
  /** True when the user has marked this group as important. Absent = not important. */
  isImportant?: boolean;

  // Precomputed
  aggregateStatus: GroupStatus;

  updatedAt: Timestamp;
}

/**
 * Precomputed group counts for a user, used to drive filter badge counts.
 * One document per user.
 *
 * Collection: user_group_counts
 * Document ID: userId
 */
export interface UserGroupCounts {
  userId: string;
  active: number;
  needsAction: number;
  done: number;
  failed: number;
  archived: number;
  totalGroups: number;
  updatedAt: Timestamp;
}
