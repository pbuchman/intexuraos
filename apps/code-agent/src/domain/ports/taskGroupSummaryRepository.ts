/**
 * Port for task group summary data access.
 *
 * Provides incremental update operations (fire-and-forget) and
 * query operations for filtering, sorting, and pagination of group summaries.
 */

import type { Result } from '@intexuraos/common-core';
import type { TaskGroupSummary, UserGroupCounts } from '../models/taskGroupSummary.js';
import type { CodeTask } from '../models/codeTask.js';
import type { GroupStatus, SortOption } from '../issueGrouping/types.js';

export interface TaskGroupSummaryRepository {
  /** Update summary after a new task is created. Fire-and-forget. @throws Never — implementations must catch and log errors internally. */
  updateAfterCreate(task: CodeTask): Promise<void>;

  /** Update summary after a task status change. Fire-and-forget. @throws Never — implementations must catch and log errors internally. */
  updateAfterStatusChange(oldTask: CodeTask, newTask: CodeTask): Promise<void>;

  /** Update summary after a task is deleted. Fire-and-forget. @throws Never — implementations must catch and log errors internally. */
  updateAfterDelete(task: CodeTask): Promise<void>;

  /** Get precomputed group counts for filter badges. */
  getUserGroupCounts(userId: string): Promise<Result<UserGroupCounts, GroupSummaryError>>;

  /** List group summaries with filtering, sorting, and pagination. */
  listGroupSummaries(input: ListGroupSummariesInput): Promise<Result<ListGroupSummariesOutput, GroupSummaryError>>;

  /** Full recompute of a group from its tasks (for backfill/repair). */
  recomputeGroupFromTasks(userId: string, groupKey: string, tasks: CodeTask[]): Promise<Result<void, GroupSummaryError>>;

  /** Recompute from the authoritative task store for write-path repair. */
  recomputeGroupFromSource(userId: string, groupKey: string): Promise<Result<void, GroupSummaryError>>;

  /**
   * Recompute aggregateStatus and persist label flags for the group identified by
   * (userId, linearIssueId), using the provided Linear labels.
   * Returns NOT_FOUND if no group summary exists for the given (userId, linearIssueId).
   */
  recomputeWithLabels(
    userId: string,
    linearIssueId: string,
    labels: { id: string; name: string }[],
    sourceTimestamp: string,
  ): Promise<Result<void, GroupSummaryError>>;

  /**
   * Toggle the isImportant flag on a group summary.
   * Returns NOT_FOUND if no summary exists for the given (userId, groupKey).
   */
  setImportant(
    userId: string,
    groupKey: string,
    important: boolean,
  ): Promise<Result<void, GroupSummaryError>>;
}

export type AskOnlyOrphanRemovalOutcome =
  | 'removed'
  | 'summary_missing'
  | 'source_unknown'
  | 'source_not_ask_only'
  | 'source_invalid'
  | 'source_changed'
  | 'summary_invalid'
  | 'counts_invalid';

export interface LifecycleBackfillGroupCountVector {
  active: number;
  needsAction: number;
  done: number;
  failed: number;
  archived: number;
  totalGroups: number;
}

export type LifecycleBackfillTargetSummaryProof =
  | { exists: false }
  | { exists: true; fingerprint: string; aggregateStatus: GroupStatus };

export interface LifecycleBackfillSummaryMutationProof {
  expectedSourceFingerprint: string;
  expectedCounts: LifecycleBackfillGroupCountVector;
  expectedTarget: LifecycleBackfillTargetSummaryProof;
}

/** Narrow maintenance extension used only by the lifecycle reconciliation command. */
export interface LifecycleBackfillTaskGroupSummaryRepository extends TaskGroupSummaryRepository {
  /**
   * Delete a stale summary only after an exact transactional source read proves
   * that at least one source task exists and every source task is ask_agent.
   */
  removeAskOnlyOrphan(
    userId: string,
    groupKey: string,
    proof: LifecycleBackfillSummaryMutationProof,
  ): Promise<Result<AskOnlyOrphanRemovalOutcome, GroupSummaryError>>;
}

export interface ListGroupSummariesInput {
  userId: string;
  statusFilter?: GroupStatus[];
  sortBy: SortOption;
  limit: number;
  cursor?: string;
}

export interface ListGroupSummariesOutput {
  summaries: TaskGroupSummary[];
  nextCursor?: string;
}

export type GroupSummaryError =
  | { code: 'FIRESTORE_ERROR'; message: string }
  | { code: 'NOT_FOUND'; message: string };
