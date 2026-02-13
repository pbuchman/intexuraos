import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import { Timestamp } from '@google-cloud/firestore';

export interface SendTaskMessageRequest {
  taskId: string;
  userId: string;
  message: string;
}

export interface SendTaskMessageResult {
  action: 'interrupted' | 'follow_up_created';
  followUpTaskId?: string;
}

export type SendTaskMessageErrorCode =
  | 'task_not_found'
  | 'task_not_running'
  | 'worker_not_configured'
  | 'message_failed'
  | 'internal_error';

export interface SendTaskMessageError {
  code: SendTaskMessageErrorCode;
  message: string;
}

export interface SendTaskMessageDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
  workerSettingsRepo: WorkerSettingsRepository;
  logLineRepo: LogLineRepository;
}

export async function sendTaskMessage(
  deps: SendTaskMessageDeps,
  request: SendTaskMessageRequest
): Promise<Result<SendTaskMessageResult, SendTaskMessageError>> {
  const { logger, codeTaskRepo, taskDispatcher, workerSettingsRepo, logLineRepo } = deps;
  const { taskId, userId, message } = request;

  const taskResult = await codeTaskRepo.findByIdForUser(taskId, userId);

  if (!taskResult.ok) {
    logger.warn({ taskId, userId, error: taskResult.error }, 'Task not found for message');
    return err({
      code: 'task_not_found',
      message: `Task ${taskId} not found`,
    });
  }

  const task = taskResult.value;

  if (task.status !== 'running' && task.status !== 'dispatched') {
    return err({
      code: 'task_not_running',
      message: `Task status "${task.status}" does not support messaging. Only running tasks can receive messages.`,
    });
  }

  // Write user message to log_lines so it appears in the terminal
  const logLine = {
    sequence: Date.now(),
    text: `\x1b[1;36m[USER MESSAGE]\x1b[0m ${message}`,
    timestamp: Timestamp.now(),
  };
  const logResult = await logLineRepo.storeBatch(taskId, [logLine]);
  /* v8 ignore start -- upstream: log write failure is non-critical, best-effort @preserve */
  if (!logResult.ok) {
    logger.warn({ taskId, error: logResult.error }, 'Failed to write user message to log_lines');
  }
  /* v8 ignore stop @preserve */

  // Fetch worker credentials
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  /* v8 ignore start -- upstream: repository error handling covered by integration tests @preserve */
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for message');
    return err({
      code: 'internal_error',
      message: 'Failed to fetch worker settings',
    });
  }
  /* v8 ignore stop @preserve */

  const settings = settingsResult.value;
  /* v8 ignore start -- ts-type: optional chaining for database result @preserve */
  const workers = (settings?.workers ?? []).filter((w) => w.enabled);
  /* v8 ignore stop @preserve */

  if (workers.length === 0) {
    return err({
      code: 'worker_not_configured',
      message: 'No workers configured',
    });
  }

  // Find the worker matching the task's workerLocation
  /* v8 ignore start -- ts-type: optional chaining for array find result @preserve */
  const matchingWorker = workers.find((w) => w.name === task.workerLocation) ?? workers[0];
  /* v8 ignore stop @preserve */

  /* v8 ignore start -- ts-type: nullish coalescing after find/fallback creates type narrowing branch @preserve */
  if (matchingWorker === undefined) {
    return err({
      code: 'worker_not_configured',
      message: 'No matching worker found',
    });
  }
  /* v8 ignore stop @preserve */

  const workerResult = await taskDispatcher.sendMessageToWorker(
    taskId,
    message,
    {
      url: matchingWorker.url,
      cfAccessClientId: matchingWorker.cfAccessClientId,
      cfAccessClientSecret: matchingWorker.cfAccessClientSecret,
      dispatchSigningSecret: matchingWorker.dispatchSigningSecret,
    }
  );

  if (!workerResult.ok) {
    logger.error({ taskId, error: workerResult.error }, 'Failed to send message to worker');
    return err({
      code: 'message_failed',
      message: workerResult.error,
    });
  }

  logger.info({ taskId }, 'User message delivered to worker');

  return ok({
    action: 'interrupted',
  });
}
