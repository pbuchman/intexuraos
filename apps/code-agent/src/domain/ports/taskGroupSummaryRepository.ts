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
  recomputeGroupFromTasks(userId: string, groupKey: string, tasks: CodeTask[]): Promise<void>;

  /**
   * Recompute aggregateStatus and persist label flags for the group identified by
   * (userId, linearIssueId), using the provided Linear labels.
   * Returns NOT_FOUND if no group summary exists for the given (userId, linearIssueId).
   */
  recomputeWithLabels(
    userId: string,
    linearIssueId: string,
    labels: { id: string; name: string }[],
  ): Promise<Result<void, GroupSummaryError>>;
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
