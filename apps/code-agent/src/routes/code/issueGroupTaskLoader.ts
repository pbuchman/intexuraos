import { ok, type Logger, type Result } from '@intexuraos/common-core';
import { SKIP_SENTRY_KEY } from '@intexuraos/infra-sentry';
import type { CodeTask } from '../../domain/models/codeTask.js';
import type {
  CodeTaskRepository,
  RepositoryError,
} from '../../domain/repositories/codeTaskRepository.js';

export async function loadExactTasksForUser(input: {
  codeTaskRepo: CodeTaskRepository;
  userId: string;
  taskIds: readonly string[];
  logger: Logger;
}): Promise<Result<CodeTask[], RepositoryError>> {
  const startedAt = Date.now();
  const uniqueTaskIds = [...new Set(input.taskIds)];
  if (uniqueTaskIds.length === 0) {
    input.logger.info({
      userId: input.userId,
      requestedTaskCount: 0,
      hydratedTaskCount: 0,
      missingTaskCount: 0,
      durationMs: Date.now() - startedAt,
      [SKIP_SENTRY_KEY]: true,
    }, 'Completed exact issue-group task hydration');
    return ok([]);
  }

  const result = await input.codeTaskRepo.findByIdsForUser(uniqueTaskIds, input.userId);
  if (!result.ok) return result;

  const taskById = new Map(result.value.map((task) => [task.id, task]));
  const tasks: CodeTask[] = [];
  let missingTaskCount = 0;
  for (const taskId of uniqueTaskIds) {
    const task = taskById.get(taskId);
    if (task === undefined) {
      missingTaskCount += 1;
    } else {
      tasks.push(task);
    }
  }

  if (missingTaskCount > 0) {
    input.logger.warn({
      userId: input.userId,
      requestedTaskCount: uniqueTaskIds.length,
      missingTaskCount,
      [SKIP_SENTRY_KEY]: true,
    }, 'Exact issue-group task references could not be hydrated');
  }

  input.logger.info({
    userId: input.userId,
    requestedTaskCount: uniqueTaskIds.length,
    hydratedTaskCount: tasks.length,
    missingTaskCount,
    durationMs: Date.now() - startedAt,
    [SKIP_SENTRY_KEY]: true,
  }, 'Completed exact issue-group task hydration');

  return ok(tasks);
}
