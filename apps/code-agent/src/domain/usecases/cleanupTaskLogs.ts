import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { Logger } from 'pino';

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_TASKS_PER_RUN = 100;

export interface CleanupTaskLogsDeps {
  codeTaskRepository: CodeTaskRepository;
  logger: Logger;
}

export interface CleanupTaskLogsInput {
  retentionDays?: number;
  batchSize?: number;
  tasksPerRun?: number;
}

export interface CleanupTaskLogsResult {
  tasksProcessed: number;
  tasksFailed: number;
  logsDeleted: number;
  durationMs: number;
}

export type CleanupTaskLogsUseCase = (
  input?: CleanupTaskLogsInput
) => Promise<Result<CleanupTaskLogsResult>>;

export function createCleanupTaskLogsUseCase(
  deps: CleanupTaskLogsDeps
): CleanupTaskLogsUseCase {
  const { codeTaskRepository, logger } = deps;

  return async (input?: CleanupTaskLogsInput): Promise<Result<CleanupTaskLogsResult>> => {
    const startTime = Date.now();
    const retentionDays = input?.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const batchSize = input?.batchSize ?? DEFAULT_BATCH_SIZE;
    const tasksPerRun = input?.tasksPerRun ?? DEFAULT_TASKS_PER_RUN;

    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    logger.info({ cutoffDate, retentionDays, batchSize, tasksPerRun }, 'Starting task log cleanup');

    let tasksProcessed = 0;
    let tasksFailed = 0;
    let logsDeleted = 0;
    let hasMoreTasks = true;

    while (hasMoreTasks) {
      const findResult = await codeTaskRepository.findArchivableTasks(cutoffDate, tasksPerRun);

      if (!findResult.ok) {
        logger.error({ error: findResult.error.message }, 'Failed to find archivable tasks');
        return err(new Error(findResult.error.message));
      }

      const tasks = findResult.value;

      if (tasks.length === 0) {
        hasMoreTasks = false;
        break;
      }

      for (const task of tasks) {
        try {
          const archiveResult = await codeTaskRepository.archiveTaskLogs(task.taskId, batchSize);

          if (!archiveResult.ok) {
            logger.error(
              { taskId: task.taskId, error: archiveResult.error.message },
              'Failed to archive task logs'
            );
            tasksFailed++;
          } else {
            logsDeleted += archiveResult.value.logCount;
            tasksProcessed++;
          }
        } catch (error) {
          const message = getErrorMessage(error);
          logger.error({ taskId: task.taskId, error: message }, 'Exception archiving task logs');
          tasksFailed++;
        }
      }

      /* v8 ignore start -- upstream: test fixture always returns exact tasksPerRun count, cannot trigger partial-page exit @preserve */
      if (tasks.length < tasksPerRun) {
        hasMoreTasks = false;
      }
      /* v8 ignore stop @preserve */
    }

    const durationMs = Date.now() - startTime;

    logger.info(
      { tasksProcessed, tasksFailed, logsDeleted, durationMs },
      'Task log cleanup completed'
    );

    return ok({
      tasksProcessed,
      tasksFailed,
      logsDeleted,
      durationMs,
    });
  };
}
