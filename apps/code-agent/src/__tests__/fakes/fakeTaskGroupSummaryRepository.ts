/**
 * In-memory fake implementation of TaskGroupSummaryRepository for use in tests.
 *
 * Computes summaries from scratch on each mutation rather than using
 * incremental deltas — correctness over optimization.
 */

import { Timestamp } from '@google-cloud/firestore';
import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type {
  TaskGroupSummaryRepository,
  ListGroupSummariesInput,
  ListGroupSummariesOutput,
  GroupSummaryError,
} from '../../domain/ports/taskGroupSummaryRepository.js';
import { hasImplementationReadyLabel, hasMergeReadyLabel } from '../../domain/issueGrouping/labelHelpers.js';
import type { TaskGroupSummary, UserGroupCounts } from '../../domain/models/taskGroupSummary.js';
import type { CodeTask } from '../../domain/models/codeTask.js';
import { deriveAggregateStatusFromSummary } from '../../domain/issueGrouping/deriveAggregateStatusFromSummary.js';
import type { SortOption } from '../../domain/issueGrouping/types.js';

const ACTIVE_STATUSES = new Set(['queued', 'dispatched', 'running']);

function hasCompletedExecutionTask(task: CodeTask): boolean {
  return (
    (task.agentType === 'execution' && (task.status === 'implemented' || task.status === 'reviewed')) ||
    (task.agentType === 'pull_request' && task.status === 'implemented')
  );
}

function now(): Timestamp {
  return Timestamp.now();
}

/**
 * Derive a TaskGroupSummary from a list of tasks that all share the same
 * (userId, groupKey). Tasks should be non-empty.
 */
function computeSummaryFromTasks(
  userId: string,
  groupKey: string,
  tasks: CodeTask[],
): TaskGroupSummary {
  const nonArchived = tasks.filter((t) => t.status !== 'archived');

  // Oldest created task (across all tasks including archived)
  const oldestCreatedAt = tasks.reduce<Timestamp>((min, t) =>
    t.createdAt.toMillis() < min.toMillis() ? t.createdAt : min,
    tasks[0]?.createdAt ?? now(),
  );

  // Latest updated non-archived task (fall back to archived if all archived)
  const latestTask = (nonArchived.length > 0 ? nonArchived : tasks).reduce<CodeTask>(
    (latest, t) => t.updatedAt.toMillis() > latest.updatedAt.toMillis() ? t : latest,
    (nonArchived.length > 0 ? nonArchived : tasks)[0] as CodeTask,
  );

  // Most recent dispatchedAt across all tasks
  let mostRecentDispatchedAt: Timestamp | null = null;
  for (const t of tasks) {
    if (t.dispatchedAt !== undefined) {
      if (mostRecentDispatchedAt === null || t.dispatchedAt.toMillis() > mostRecentDispatchedAt.toMillis()) {
        mostRecentDispatchedAt = t.dispatchedAt;
      }
    }
  }

  const agentTypesPresent: string[] = Array.from(
    new Set(tasks.map((t) => t.agentType).filter((a): a is NonNullable<typeof a> => a !== undefined)),
  );

  const hasCompletedPlanning = tasks.some((t) => t.agentType === 'planning' && t.status === 'planned');
  const hasCompletedExecution = tasks.some((t) => hasCompletedExecutionTask(t));
  const hasImplementationTaskId = tasks.some(
    (t) => t.implementationTaskId !== undefined || (t.fanOutChildTaskIds !== undefined && t.fanOutChildTaskIds.length > 0),
  );
  const hasPrUrl = tasks.some((t) => t.result?.prUrl !== undefined);
  const prNumber = tasks.find((t) => t.prNumber !== undefined)?.prNumber ?? null;

  // latestReviewNeedsRemediation: from the most recently updated review task
  let latestReviewNeedsRemediation: boolean | null = null;
  const reviewTasks = tasks
    .filter((t) => t.agentType === 'review' && t.status === 'reviewed')
    .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis());
  if (reviewTasks.length > 0) {
    const reviewTask = reviewTasks[0] as CodeTask;
    const needsRemediation = reviewTask.result?.needs_remediation;
    latestReviewNeedsRemediation = needsRemediation === '0' ? false : needsRemediation === '1' ? true : null;
  }

  const aggregateStatus = deriveAggregateStatusFromSummary({
    activeTaskCount: tasks.filter((t) => ACTIVE_STATUSES.has(t.status)).length,
    hasCompletedPlanning,
    hasCompletedExecution,
    hasImplementationTaskId,
    hasPrUrl,
    latestTaskStatus: latestTask.status,
    latestReviewNeedsRemediation,
  });

  const linearIssueId = tasks.find((t) => t.linearIssueId !== undefined)?.linearIssueId ?? null;

  return {
    userId,
    linearIssueId,
    groupKey,
    taskCount: tasks.length,
    activeTaskCount: tasks.filter((t) => ACTIVE_STATUSES.has(t.status)).length,
    latestTaskStatus: latestTask.status,
    latestTaskUpdatedAt: latestTask.updatedAt,
    agentTypesPresent,
    hasCompletedPlanning,
    hasCompletedExecution,
    hasImplementationTaskId,
    hasPrUrl,
    prNumber,
    latestReviewNeedsRemediation,
    oldestTaskCreatedAt: oldestCreatedAt,
    mostRecentDispatchedAt,
    aggregateStatus,
    updatedAt: now(),
  };
}

/**
 * Compute UserGroupCounts from all summaries belonging to a user.
 */
function computeCountsFromSummaries(userId: string, userSummaries: TaskGroupSummary[]): UserGroupCounts {
  let active = 0;
  let needsAction = 0;
  let done = 0;
  let failed = 0;

  for (const s of userSummaries) {
    if (s.aggregateStatus === 'active') active++;
    else if (s.aggregateStatus === 'needs-action') needsAction++;
    else if (s.aggregateStatus === 'done') done++;
    else if (s.aggregateStatus === 'failed') failed++;
  }

  return {
    userId,
    active,
    needsAction,
    done,
    failed,
    totalGroups: userSummaries.length,
    updatedAt: now(),
  };
}

function summaryKey(userId: string, groupKey: string): string {
  return `${userId}_${groupKey}`;
}

function sortSummaries(summaries: TaskGroupSummary[], sortBy: SortOption): TaskGroupSummary[] {
  const sorted = [...summaries];
  switch (sortBy) {
    case 'last-updated':
      sorted.sort((a, b) => b.oldestTaskCreatedAt.toMillis() - a.oldestTaskCreatedAt.toMillis());
      break;
    case 'dispatched':
      sorted.sort((a, b) => {
        const aMs = a.mostRecentDispatchedAt?.toMillis() ?? 0;
        const bMs = b.mostRecentDispatchedAt?.toMillis() ?? 0;
        return bMs - aMs;
      });
      break;
    case 'pr-number':
      sorted.sort((a, b) => (b.prNumber ?? 0) - (a.prNumber ?? 0));
      break;
    case 'linear-id':
      sorted.sort((a, b) => (a.linearIssueId ?? '').localeCompare(b.linearIssueId ?? ''));
      break;
  }
  return sorted;
}

export interface FakeTaskGroupSummaryRepository extends TaskGroupSummaryRepository {
  /** Direct access for test assertions. */
  getSummary(userId: string, groupKey: string): TaskGroupSummary | undefined;
  /** Direct access for test assertions. */
  getCounts(userId: string): UserGroupCounts | undefined;
  /** Clear all data — call in afterEach. */
  reset(): void;
}

export function createFakeTaskGroupSummaryRepository(): FakeTaskGroupSummaryRepository {
  const summaries = new Map<string, TaskGroupSummary>();
  const counts = new Map<string, UserGroupCounts>();

  function rebuildCountsForUser(userId: string): void {
    const userSummaries = Array.from(summaries.values()).filter((s) => s.userId === userId);
    counts.set(userId, computeCountsFromSummaries(userId, userSummaries));
  }

  function upsertSummary(summary: TaskGroupSummary): void {
    summaries.set(summaryKey(summary.userId, summary.groupKey), summary);
    rebuildCountsForUser(summary.userId);
  }

  function removeSummary(userId: string, groupKey: string): void {
    summaries.delete(summaryKey(userId, groupKey));
    rebuildCountsForUser(userId);
  }

  /**
   * Derive groupKey for a task: linearIssueId when present, otherwise standalone_{taskId}.
   */
  function groupKeyOf(task: CodeTask): string {
    return task.linearIssueId ?? `standalone_${task.id}`;
  }

  /**
   * Collect all tasks that share the same (userId, groupKey) as the given task,
   * including the task itself, by scanning the current summaries state.
   *
   * The fake does not store raw tasks — for updateAfter* methods we reconstruct
   * the group from the single task provided (sufficient for decorator/route tests
   * which only care about the interface being callable and producing consistent state).
   */
  function upsertFromSingleTask(task: CodeTask): void {
    const gKey = groupKeyOf(task);
    upsertSummary(computeSummaryFromTasks(task.userId, gKey, [task]));
  }

  return {
    async updateAfterCreate(task: CodeTask): Promise<void> {
      upsertFromSingleTask(task);
    },

    async updateAfterStatusChange(_oldTask: CodeTask, newTask: CodeTask): Promise<void> {
      upsertFromSingleTask(newTask);
    },

    async updateAfterDelete(task: CodeTask): Promise<void> {
      const gKey = groupKeyOf(task);
      removeSummary(task.userId, gKey);
    },

    async getUserGroupCounts(userId: string): Promise<Result<UserGroupCounts, GroupSummaryError>> {
      const existing = counts.get(userId);
      if (existing !== undefined) {
        return ok(existing);
      }
      // Return zeros for unknown users
      return ok({
        userId,
        active: 0,
        needsAction: 0,
        done: 0,
        failed: 0,
        totalGroups: 0,
        updatedAt: now(),
      });
    },

    async listGroupSummaries(input: ListGroupSummariesInput): Promise<Result<ListGroupSummariesOutput, GroupSummaryError>> {
      let results = Array.from(summaries.values()).filter((s) => s.userId === input.userId);

      if (input.statusFilter !== undefined && input.statusFilter.length > 0) {
        const filterSet = new Set(input.statusFilter);
        results = results.filter((s) => filterSet.has(s.aggregateStatus));
      }

      results = sortSummaries(results, input.sortBy);

      // Cursor-based pagination: cursor is the groupKey of the last item in previous page
      let startIndex = 0;
      if (input.cursor !== undefined) {
        const idx = results.findIndex((s) => s.groupKey === input.cursor);
        if (idx !== -1) {
          startIndex = idx + 1;
        }
      }

      const page = results.slice(startIndex, startIndex + input.limit);
      const lastItem = page[page.length - 1];
      const hasNextPage = page.length === input.limit && startIndex + input.limit < results.length;
      const nextCursor = hasNextPage ? lastItem?.groupKey : undefined;

      return ok({ summaries: page, ...(nextCursor !== undefined && { nextCursor }) });
    },

    async recomputeGroupFromTasks(userId: string, groupKey: string, tasks: CodeTask[]): Promise<void> {
      if (tasks.length === 0) {
        removeSummary(userId, groupKey);
        return;
      }
      const current = summaries.get(summaryKey(userId, groupKey));
      const next = computeSummaryFromTasks(userId, groupKey, tasks);
      if (current !== undefined) {
        if (current.hasImplementationReadyLabel !== undefined) {
          next.hasImplementationReadyLabel = current.hasImplementationReadyLabel;
        }
        if (current.hasMergeReadyLabel !== undefined) {
          next.hasMergeReadyLabel = current.hasMergeReadyLabel;
        }
        if (current.labelsUpdatedAt !== undefined) {
          next.labelsUpdatedAt = current.labelsUpdatedAt;
        }
        next.aggregateStatus = deriveAggregateStatusFromSummary(next);
      }
      upsertSummary(next);
    },

    async recomputeWithLabels(
      userId: string,
      linearIssueId: string,
      labels: { id: string; name: string }[],
      sourceTimestamp: string,
    ): Promise<Result<void, GroupSummaryError>> {
      const key = summaryKey(userId, linearIssueId);
      const current = summaries.get(key);
      if (current === undefined) {
        return err({ code: 'NOT_FOUND', message: `No group summary found for ${userId}/${linearIssueId}` });
      }
      const sourceTs = Timestamp.fromDate(new Date(sourceTimestamp));
      if (current.labelsUpdatedAt !== undefined && sourceTs.toMillis() < current.labelsUpdatedAt.toMillis()) {
        return ok(undefined);
      }
      const updated: TaskGroupSummary = {
        ...current,
        hasImplementationReadyLabel: hasImplementationReadyLabel(labels),
        hasMergeReadyLabel: hasMergeReadyLabel(labels),
        labelsUpdatedAt: sourceTs,
      };
      updated.aggregateStatus = deriveAggregateStatusFromSummary(updated);
      upsertSummary(updated);
      return ok(undefined);
    },

    getSummary(userId: string, groupKey: string): TaskGroupSummary | undefined {
      return summaries.get(summaryKey(userId, groupKey));
    },

    getCounts(userId: string): UserGroupCounts | undefined {
      return counts.get(userId);
    },

    reset(): void {
      summaries.clear();
      counts.clear();
    },
  };
}
