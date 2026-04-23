/**
 * Use case: Cancel a code task owned by the authenticated user.
 *
 * Extracted from the `POST /code/cancel` route handler as part of INT-1430 so
 * that the public cancel endpoint follows the same thin-handler pattern as the
 * internal `cancelTaskWithNonce` path. The route handler becomes: parse body →
 * call use case → map result to reply.
 *
 * Workflow:
 *   1. Fetch task by ID
 *   2. Verify the requesting user owns the task
 *   3. Check the task is in a cancellable state (`dispatched`, `running`, `queued`)
 *   4. Update Firestore status to `cancelled` (source of truth)
 *   5. Notify the worker to stop (best effort — failures are logged, not fatal)
 *   6. Mirror the cancelled status to the originating action (best effort)
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { StatusMirrorService } from '../services/statusMirrorService.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';

export interface CancelTaskRequest {
  taskId: string;
  userId: string;
  /** Optional trace ID forwarded to the status-mirror side-effect. */
  traceId?: string;
}

export type CancelTaskErrorCode =
  | 'task_not_found'
  | 'not_owner'
  | 'task_not_cancellable'
  | 'internal_error';

export interface CancelTaskError {
  code: CancelTaskErrorCode;
  message: string;
}

export interface CancelTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
  workerSettingsRepo: WorkerSettingsRepository;
  statusMirrorService: StatusMirrorService;
}

const CANCELLABLE_STATUSES = ['dispatched', 'running', 'queued'] as const;

export async function cancelTask(
  deps: CancelTaskDeps,
  request: CancelTaskRequest
): Promise<Result<{ cancelled: true }, CancelTaskError>> {
  const { logger, codeTaskRepo, taskDispatcher, workerSettingsRepo, statusMirrorService } = deps;
  const { taskId, userId, traceId } = request;

  // Step 1: Fetch task
  const taskResult = await codeTaskRepo.findById(taskId);
  if (!taskResult.ok) {
    logger.warn({ taskId, errorCode: taskResult.error.code }, 'Task not found for cancellation');
    return err({ code: 'task_not_found', message: 'Task not found' });
  }
  const task = taskResult.value;

  // Step 2: Verify ownership
  if (task.userId !== userId) {
    logger.warn(
      { taskId, taskUserId: task.userId, requestUserId: userId },
      'Cancellation forbidden - not task owner'
    );
    return err({ code: 'not_owner', message: 'Not authorized to cancel this task' });
  }

  // Step 3: Check task is cancellable
  if (!CANCELLABLE_STATUSES.includes(task.status as (typeof CANCELLABLE_STATUSES)[number])) {
    logger.info({ taskId, status: task.status }, 'Cannot cancel task - not in cancellable state');
    return err({ code: 'task_not_cancellable', message: 'Task is not in a cancellable state' });
  }

  // Step 4: Update Firestore status to cancelled (source of truth)
  const updateResult = await codeTaskRepo.update(taskId, { status: 'cancelled' });
  if (!updateResult.ok) {
    logger.error({ taskId, error: updateResult.error }, 'Failed to update task status to cancelled');
    return err({ code: 'internal_error', message: 'Failed to cancel task' });
  }

  // Step 5: Notify worker to stop (best effort)
  try {
    const settingsResult = await workerSettingsRepo.getSettings(userId);
    let workerCreds: { url: string; cfAccessClientId: string; cfAccessClientSecret: string } | undefined;
    if (settingsResult.ok && settingsResult.value !== null) {
      const settings = settingsResult.value;
      const workerConfig = settings.workers.find((w) => w.name === task.workerLocation);
      if (workerConfig?.enabled === true) {
        workerCreds = {
          url: workerConfig.url,
          cfAccessClientId: workerConfig.cfAccessClientId,
          cfAccessClientSecret: workerConfig.cfAccessClientSecret,
        };
      }
    }
    await taskDispatcher.cancelOnWorker(taskId, task.workerLocation, workerCreds);
  } catch (error) {
    logger.warn({ taskId, error }, 'Failed to notify worker of cancellation');
  }

  // Step 6: Mirror cancelled status to the originating action (non-fatal).
  // `traceId` is optional on mirrorStatus — only pass it when the caller
  // supplied one so exactOptionalPropertyTypes doesn't reject `undefined`.
  await statusMirrorService.mirrorStatus({
    actionId: task.actionId,
    taskStatus: 'cancelled',
    ...(traceId !== undefined ? { traceId } : {}),
  });

  logger.info({ taskId }, 'Code task cancelled successfully');
  return ok({ cancelled: true });
}
