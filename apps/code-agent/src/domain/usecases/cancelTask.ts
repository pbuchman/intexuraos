/**
 * Use case: Cancel a code task owned by the authenticated user.
 *
 * Extracted from the `POST /code/cancel` route handler as part of INT-1430 so
 * that the public cancel endpoint follows the same thin-handler pattern as the
 * internal `cancelTaskWithNonce` path. The route handler becomes: parse body →
 * call use case → map result to reply.
 *
 * Queued tasks are cancelled atomically. Dispatched/running tasks stay active
 * until their worker confirms the stop request, then the matching dispatch is
 * terminalized in a fenced transaction.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import { cancelActiveTask } from './cancelActiveTask.js';
import { buildLockCleanups, type LockCleanupInfo } from '../utils/prTaskLock.js';

export interface CancelTaskRequest {
  taskId: string;
  userId: string;
  /** Optional trace ID for request correlation. */
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
}

export async function cancelTask(
  deps: CancelTaskDeps,
  request: CancelTaskRequest
): Promise<Result<{ cancelled: true; locksToCleanup: LockCleanupInfo[] }, CancelTaskError>> {
  const { logger } = deps;
  const { taskId, userId, traceId } = request;

  const cancellationResult = await cancelActiveTask(deps, { taskId, userId });
  if (!cancellationResult.ok) {
    const error = cancellationResult.error;
    // This entry point never supplies a nonce, so the shared cancellation core
    // cannot produce either nonce-specific error variant.
    const publicCode = error.code as CancelTaskErrorCode;
    return err({ code: publicCode, message: error.message });
  }

  logger.info({ taskId, traceId }, 'Code task cancelled successfully');
  return ok({
    cancelled: true,
    locksToCleanup: buildLockCleanups(cancellationResult.value.task),
  });
}
