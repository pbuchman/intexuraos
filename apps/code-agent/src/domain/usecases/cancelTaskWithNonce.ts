/**
 * Use case: Cancel a task using nonce validation.
 *
 * Called by actions-agent when processing WhatsApp cancel button callback.
 * Validates nonce, ownership, and expiration before canceling.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';

export interface CancelTaskWithNonceRequest {
  taskId: string;
  nonce: string;
  userId: string;
}

export type CancelTaskWithNonceErrorCode =
  | 'task_not_found'
  | 'invalid_nonce'
  | 'nonce_expired'
  | 'not_owner'
  | 'task_not_cancellable'
  | 'internal_error';

export interface CancelTaskWithNonceError {
  code: CancelTaskWithNonceErrorCode;
  message: string;
}

export interface CancelTaskWithNonceDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
}

/**
 * Cancel a task using nonce validation.
 *
 * Workflow:
 * 1. Fetch task by ID
 * 2. Validate nonce matches
 * 3. Check nonce not expired
 * 4. Verify user owns the task
 * 5. Check task is cancellable (dispatched or running)
 * 6. Update task status to cancelled, clear nonce
 * 7. Notify worker to stop (best effort)
 */
export async function cancelTaskWithNonce(
  deps: CancelTaskWithNonceDeps,
  request: CancelTaskWithNonceRequest
): Promise<Result<{ cancelled: true }, CancelTaskWithNonceError>> {
  const { logger, codeTaskRepo, taskDispatcher } = deps;
  const { taskId, nonce, userId } = request;

  // Step 1: Fetch task
  const taskResult = await codeTaskRepo.findById(taskId);
  if (!taskResult.ok) {
    logger.warn({ taskId, error: taskResult.error }, 'Task not found for nonce cancellation');
    return err({ code: 'task_not_found', message: 'Task not found' });
  }

  const task = taskResult.value;

  // Step 2: Validate nonce matches
  if (task.cancelNonce === undefined || task.cancelNonce !== nonce) {
    logger.warn({ taskId, providedNonce: nonce }, 'Invalid cancel nonce');
    return err({ code: 'invalid_nonce', message: 'Invalid cancel nonce' });
  }

  // Step 3: Check nonce not expired
  if (task.cancelNonceExpiresAt !== undefined) {
    const expiresAt = new Date(task.cancelNonceExpiresAt);
    if (expiresAt < new Date()) {
      logger.warn({ taskId, expiresAt }, 'Cancel nonce expired');
      return err({ code: 'nonce_expired', message: 'Cancel nonce has expired' });
    }
  }

  // Step 4: Verify user owns the task
  if (task.userId !== userId) {
    logger.warn({ taskId, taskUserId: task.userId, requestUserId: userId }, 'User does not own task');
    return err({ code: 'not_owner', message: 'You do not own this task' });
  }

  // Step 5: Check task is cancellable
  const cancellableStatuses = ['dispatched', 'running'];
  if (!cancellableStatuses.includes(task.status)) {
    logger.info({ taskId, status: task.status }, 'Task not in cancellable state');
    return err({ code: 'task_not_cancellable', message: `Task is ${task.status}, cannot cancel` });
  }

  // Step 6: Update task status to cancelled, clear nonce (single-use)
  const updateResult = await codeTaskRepo.update(taskId, {
    status: 'cancelled',
    cancelNonce: null,
    cancelNonceExpiresAt: null,
  });

  if (!updateResult.ok) {
    logger.error({ taskId, error: updateResult.error }, 'Failed to cancel task');
    return err({ code: 'internal_error', message: 'Failed to cancel task' });
  }

  // Step 7: Notify worker to stop (best effort)
  try {
    await taskDispatcher.cancelOnWorker(taskId, task.workerLocation);
  } catch (error) {
    logger.warn({ taskId, error }, 'Failed to notify worker of cancellation');
  }

  logger.info({ taskId }, 'Task cancelled via nonce');
  return ok({ cancelled: true });
}
