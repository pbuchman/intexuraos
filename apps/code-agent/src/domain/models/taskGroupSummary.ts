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
  /** linearIssueId when present, otherwise `standalone_{taskId}` */
  groupKey: string;

  // Aggregate fields
  taskCount: number;
  /** Tasks with status in {queued, dispatched, running} */
  activeTaskCount: number;
  latestTaskStatus: string;
  latestTaskUpdatedAt: Timestamp;
  agentTypesPresent: string[];
  hasCompletedPlanning: boolean;
  hasCompletedExecution: boolean;
  /** True when an execution-agent task (not pull_request) has completed. */
  hasCompletedExecutionAgent: boolean;
  hasImplementationTaskId: boolean;
  hasPrUrl: boolean;
  prNumber: number | null;
  latestReviewNeedsRemediation: boolean | null;

  // Sort key fields
  oldestTaskCreatedAt: Timestamp;
  mostRecentDispatchedAt: Timestamp | null;

  // Label flags from Linear (set via recomputeWithLabels, absent on legacy docs)
  hasImplementationReadyLabel?: boolean;
  hasMergeReadyLabel?: boolean;
  labelsUpdatedAt?: Timestamp;

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
  totalGroups: number;
  updatedAt: Timestamp;
}
