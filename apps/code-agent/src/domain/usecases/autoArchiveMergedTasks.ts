import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { Logger } from 'pino';
import { ACTIVE_STATUSES } from '../issueGrouping/constants.js';

const DEFAULT_MERGE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AutoArchiveMergedTasksDeps {
  codeTaskRepository: CodeTaskRepository;
  logger: Logger;
}

export interface AutoArchiveMergedTasksInput {
  mergeDays?: number;
}

export interface AutoArchiveMergedTasksResult {
  totalTasksFetched: number;
  totalGroupsEvaluated: number;
  groupsArchived: number;
  groupsSkippedActive: number;
  tasksArchived: number;
  tasksFailed: number;
  durationMs: number;
}

export type AutoArchiveMergedTasksUseCase = (
  input?: AutoArchiveMergedTasksInput
) => Promise<Result<AutoArchiveMergedTasksResult>>;

export function createAutoArchiveMergedTasksUseCase(
  deps: AutoArchiveMergedTasksDeps
): AutoArchiveMergedTasksUseCase {
  const { codeTaskRepository, logger } = deps;

  return async (input?: AutoArchiveMergedTasksInput): Promise<Result<AutoArchiveMergedTasksResult>> => {
    const startTime = Date.now();
    const mergeDays = input?.mergeDays ?? DEFAULT_MERGE_DAYS;
    const cutoffDate = new Date(Date.now() - mergeDays * MS_PER_DAY);

    logger.info({ mergeDays, cutoffDate }, 'Starting auto-archive of merged tasks');

    const findResult = await codeTaskRepository.findAllNonArchived();
    if (!findResult.ok) {
      logger.error({ error: findResult.error.message }, 'Failed to find non-archived tasks');
      return err(new Error(findResult.error.message));
    }

    const allTasks = findResult.value;
    const totalTasksFetched = allTasks.length;

    if (totalTasksFetched === 0) {
      const durationMs = Date.now() - startTime;
      logger.info({ durationMs }, 'No non-archived tasks found');
      return ok({
        totalTasksFetched: 0,
        totalGroupsEvaluated: 0,
        groupsArchived: 0,
        groupsSkippedActive: 0,
        tasksArchived: 0,
        tasksFailed: 0,
        durationMs,
      });
    }

    // Group all tasks by linearIssueId first (including active ones)
    const groups = new Map<string, typeof allTasks>();
    for (const task of allTasks) {
      const groupKey = task.linearIssueId ?? task.id;
      const existing = groups.get(groupKey) ?? [];
      existing.push(task);
      groups.set(groupKey, existing);
    }

    const totalGroupsEvaluated = groups.size;
    let groupsArchived = 0;
    let groupsSkippedActive = 0;
    let tasksArchived = 0;
    let tasksFailed = 0;

    for (const [groupKey, groupTasks] of groups) {
      // Safety: skip groups that have active tasks (running/dispatched/queued)
      const hasActive = groupTasks.some((t) => ACTIVE_STATUSES.has(t.status));
      if (hasActive) {
        logger.info(
          { groupKey, taskCount: groupTasks.length, reason: 'has_active_task' },
          'Skipping group with active task'
        );
        groupsSkippedActive++;
        continue;
      }

      // Filter to only tasks with prMergedAt < cutoffDate (archive candidates)
      const expiredTasks = groupTasks.filter(
        (t) => t.prMergedAt !== undefined && t.prMergedAt.toDate() < cutoffDate
      );

      // If no expired tasks in this group, skip
      if (expiredTasks.length === 0) {
        continue;
      }

      logger.info(
        { groupKey, taskCount: expiredTasks.length },
        'Archiving group with expired merged PR'
      );

      let groupHadSuccess = false;
      for (const task of expiredTasks) {
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
              { taskId: task.id, groupKey, previousStatus: task.status },
              'Archived task with merged PR'
            );
            tasksArchived++;
            groupHadSuccess = true;
          }
        } catch (error) {
          const message = getErrorMessage(error);
          logger.error({ taskId: task.id, groupKey, error: message }, 'Failed to archive task');
          tasksFailed++;
        }
      }

      if (groupHadSuccess) {
        groupsArchived++;
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info(
      {
        totalTasksFetched,
        totalGroupsEvaluated,
        groupsArchived,
        groupsSkippedActive,
        tasksArchived,
        tasksFailed,
        durationMs,
      },
      'Auto-archive of merged tasks completed'
    );

    return ok({
      totalTasksFetched,
      totalGroupsEvaluated,
      groupsArchived,
      groupsSkippedActive,
      tasksArchived,
      tasksFailed,
      durationMs,
    });
  };
}
