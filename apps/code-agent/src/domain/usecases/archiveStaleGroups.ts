import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { Logger } from 'pino';
import { ACTIVE_STATUSES } from '../issueGrouping/constants.js';

const DEFAULT_STALE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ArchiveStaleGroupsDeps {
  codeTaskRepository: CodeTaskRepository;
  logger: Logger;
}

export interface ArchiveStaleGroupsInput {
  staleDays?: number;
}

export interface ArchiveStaleGroupsResult {
  totalTasksFetched: number;
  totalGroupsEvaluated: number;
  groupsArchived: number;
  groupsRetained: number;
  groupsSkippedActive: number;
  tasksArchived: number;
  tasksFailed: number;
  durationMs: number;
}

export type ArchiveStaleGroupsUseCase = (
  input?: ArchiveStaleGroupsInput
) => Promise<Result<ArchiveStaleGroupsResult>>;

export function createArchiveStaleGroupsUseCase(
  deps: ArchiveStaleGroupsDeps
): ArchiveStaleGroupsUseCase {
  const { codeTaskRepository, logger } = deps;

  return async (input?: ArchiveStaleGroupsInput): Promise<Result<ArchiveStaleGroupsResult>> => {
    const startTime = Date.now();
    const staleDays = input?.staleDays ?? DEFAULT_STALE_DAYS;
    const cutoffDate = new Date(Date.now() - staleDays * MS_PER_DAY);

    logger.info({ staleDays, cutoffDate }, 'Starting stale issue group archival');

    const listResult = await codeTaskRepository.listAllNonArchivedGlobal();
    if (!listResult.ok) {
      logger.error({ error: listResult.error.message }, 'Failed to list non-archived tasks');
      return err(new Error(listResult.error.message));
    }

    const allTasks = listResult.value;
    const totalTasksFetched = allTasks.length;

    const groups = new Map<string, typeof allTasks>();
    for (const task of allTasks) {
      const groupKey = task.linearIssueId ?? task.id;
      const existing = groups.get(groupKey) ?? [];
      existing.push(task);
      groups.set(groupKey, existing);
    }

    const totalGroupsEvaluated = groups.size;
    let groupsArchived = 0;
    let groupsRetained = 0;
    let groupsSkippedActive = 0;
    let tasksArchived = 0;
    let tasksFailed = 0;

    const cutoffMs = cutoffDate.getTime();

    for (const [groupKey, tasks] of groups) {
      const linearIssueId = tasks[0]?.linearIssueId;
      const taskCount = tasks.length;

      // Check for any active task in the group
      const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
      if (hasActive) {
        logger.info(
          { groupKey, taskCount, reason: 'has_active_task' },
          'Retaining issue group'
        );
        groupsSkippedActive++;
        continue;
      }

      // Compute max updatedAt across the group
      let maxUpdatedAtMs = 0;
      for (const task of tasks) {
        const ms = task.updatedAt.toMillis();
        if (ms > maxUpdatedAtMs) {
          maxUpdatedAtMs = ms;
        }
      }

      if (maxUpdatedAtMs >= cutoffMs) {
        const maxUpdatedAt = new Date(maxUpdatedAtMs);
        logger.info(
          {
            groupKey,
            taskCount,
            maxUpdatedAt: maxUpdatedAt.toISOString(),
            reason: 'not_stale',
          },
          'Retaining issue group'
        );
        groupsRetained++;
        continue;
      }

      // Group is stale — archive all tasks
      const daysSinceUpdate = Math.floor((Date.now() - maxUpdatedAtMs) / MS_PER_DAY);
      logger.info(
        { groupKey, linearIssueId, taskCount, daysSinceUpdate },
        'Archiving stale issue group'
      );

      for (const task of tasks) {
        try {
          const updateResult = await codeTaskRepository.update(task.id, { status: 'archived' });
          if (!updateResult.ok) {
            logger.error(
              { taskId: task.id, groupKey, error: updateResult.error.message },
              'Failed to archive task'
            );
            tasksFailed++;
          } else {
            logger.info(
              { taskId: task.id, groupKey, status: task.status },
              'Archived task in stale group'
            );
            tasksArchived++;
          }
        } catch (error) {
          const message = getErrorMessage(error);
          logger.error({ taskId: task.id, groupKey, error: message }, 'Failed to archive task');
          tasksFailed++;
        }
      }

      groupsArchived++;
    }

    const durationMs = Date.now() - startTime;

    logger.info(
      {
        totalTasksFetched,
        totalGroupsEvaluated,
        groupsArchived,
        groupsRetained,
        groupsSkippedActive,
        tasksArchived,
        tasksFailed,
        durationMs,
      },
      'Stale issue group archival completed'
    );

    return ok({
      totalTasksFetched,
      totalGroupsEvaluated,
      groupsArchived,
      groupsRetained,
      groupsSkippedActive,
      tasksArchived,
      tasksFailed,
      durationMs,
    });
  };
}
