import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { GitHubPRSummaryRepository } from '../repositories/gitHubPRSummaryRepository.js';
import type { Logger } from 'pino';
import { ACTIVE_STATUSES } from '../issueGrouping/constants.js';
import { resolveTaskLifecycleTime } from '../models/taskLifecycleTime.js';

const DEFAULT_STALE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ArchiveStaleGroupsDeps {
  codeTaskRepository: CodeTaskRepository;
  gitHubPRSummaryRepo: Pick<GitHubPRSummaryRepository, 'findAllOpen'>;
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
  const { codeTaskRepository, gitHubPRSummaryRepo, logger } = deps;

  return async (input?: ArchiveStaleGroupsInput): Promise<Result<ArchiveStaleGroupsResult>> => {
    const startTime = Date.now();
    const staleDays = input?.staleDays ?? DEFAULT_STALE_DAYS;
    const cutoffDate = new Date(startTime - staleDays * MS_PER_DAY);

    logger.info({ staleDays, cutoffDate }, 'Starting stale issue group archival');

    const listResult = await codeTaskRepository.listAllNonArchivedGlobal();
    if (!listResult.ok) {
      logger.error({ error: listResult.error.message }, 'Failed to list non-archived tasks');
      return err(new Error(listResult.error.message));
    }

    const allTasks = listResult.value;
    const totalTasksFetched = allTasks.length;

    const openPRResult = await gitHubPRSummaryRepo.findAllOpen();
    if (!openPRResult.ok) {
      logger.error({ error: openPRResult.error.message }, 'Failed to list open PR summaries');
      return err(new Error(openPRResult.error.message));
    }

    const openPRKeys = new Set(
      openPRResult.value.map((summary) =>
        `${summary.repository}#${String(summary.pullRequestNumber)}`
      )
    );

    const groups = new Map<
      string,
      { userId: string; groupKey: string; tasks: typeof allTasks }
    >();
    for (const task of allTasks) {
      const groupKey = task.linearIssueId ?? task.id;
      const identity = JSON.stringify([task.userId, groupKey]);
      const existing = groups.get(identity);
      if (existing === undefined) {
        groups.set(identity, { userId: task.userId, groupKey, tasks: [task] });
      } else {
        existing.tasks.push(task);
      }
    }

    const totalGroupsEvaluated = groups.size;
    let groupsArchived = 0;
    let groupsRetained = 0;
    let groupsSkippedActive = 0;
    let tasksArchived = 0;
    let tasksFailed = 0;

    const cutoffMs = cutoffDate.getTime();

    for (const { userId, groupKey, tasks } of groups.values()) {
      const linearIssueId = tasks[0]?.linearIssueId;
      const taskCount = tasks.length;

      // Check for any active task in the group
      const hasActive = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
      if (hasActive) {
        logger.info(
          { userId, groupKey, taskCount, reason: 'has_active_task' },
          'Retaining issue group'
        );
        groupsSkippedActive++;
        continue;
      }

      const hasOpenPR = tasks.some((task) =>
        task.prNumber !== undefined &&
        openPRKeys.has(`${task.repository}#${String(task.prNumber)}`)
      );
      if (hasOpenPR) {
        logger.info(
          { userId, groupKey, taskCount, reason: 'has_open_pr' },
          'Retaining issue group'
        );
        groupsRetained++;
        continue;
      }

      const resolvedTasks = tasks.map((task) => ({
        task,
        lifecycle: resolveTaskLifecycleTime(task),
      }));
      let maxLifecycleAtMs = 0;
      for (const resolvedTask of resolvedTasks) {
        const ms = resolvedTask.lifecycle.at.toMillis();
        if (ms > maxLifecycleAtMs) {
          maxLifecycleAtMs = ms;
        }
      }

      const maxLifecycleAt = new Date(maxLifecycleAtMs);
      if (maxLifecycleAtMs >= cutoffMs) {
        logger.info(
          {
            userId,
            groupKey,
            taskCount,
            maxLifecycleAt: maxLifecycleAt.toISOString(),
            reason: 'not_stale',
          },
          'Retaining issue group'
        );
        groupsRetained++;
        continue;
      }

      // Group is stale — archive all tasks
      const daysSinceLifecycleActivity = Math.floor(
        (startTime - maxLifecycleAtMs) / MS_PER_DAY,
      );
      logger.info(
        {
          userId,
          groupKey,
          linearIssueId,
          taskCount,
          maxLifecycleAt: maxLifecycleAt.toISOString(),
          daysSinceLifecycleActivity,
        },
        'Archiving stale issue group'
      );

      for (const { task, lifecycle } of resolvedTasks) {
        try {
          const updateResult = await codeTaskRepository.update(task.id, {
            status: 'archived',
            ...(task.completedAt === undefined && {
              completedAt: lifecycle.at.toDate(),
            }),
          });
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
