/**
 * Use case: Cancel a task using nonce validation.
 *
 * Called by WhatsApp service when processing cancel button callbacks.
 * Validates nonce, ownership, and expiration before canceling.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import { buildLockCleanups, type LockCleanupInfo } from '../utils/prTaskLock.js';
import { cancelActiveTask } from './cancelActiveTask.js';

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
  workerSettingsRepo: WorkerSettingsRepository;
}

/**
 * Cancel a task using nonce validation.
 *
 * Uses the same atomic and worker-confirmed cancellation path as the public
 * endpoint, with nonce validation performed inside the preparation transaction.
 */
export async function cancelTaskWithNonce(
  deps: CancelTaskWithNonceDeps,
  request: CancelTaskWithNonceRequest
): Promise<Result<{ cancelled: true; locksToCleanup: LockCleanupInfo[] }, CancelTaskWithNonceError>> {
  const { logger } = deps;
  const { taskId, nonce, userId } = request;

  const cancellationResult = await cancelActiveTask(deps, {
    taskId,
    nonce,
    userId,
  });
  if (!cancellationResult.ok) {
    const error = cancellationResult.error;
    return err({
      code: error.code,
      message: error.code === 'not_owner' ? 'You do not own this task' : error.message,
    });
  }

  const locksToCleanup = buildLockCleanups(cancellationResult.value.task);

  logger.info({ taskId }, 'Task cancelled via nonce');
  return ok({ cancelled: true, locksToCleanup });
}
