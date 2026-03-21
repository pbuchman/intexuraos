/**
 * Unified task enqueue service (INT-949).
 *
 * The ONLY way to submit tasks for dispatch. Replaces direct
 * taskDispatcher.dispatch() calls in all usecases.
 *
 * Every task goes through the persistent Firestore queue.
 * The drainTaskQueue Cloud Scheduler job dispatches them one at a time.
 */

import type { Result } from '@intexuraos/common-core';

export interface EnqueueTaskInput {
  /** ID of the task to enqueue (must already exist in Firestore with status='queued'). */
  taskId: string;
  /** User ID who owns the task (for WhatsApp notification). */
  userId: string;
}

export interface EnqueueResult {
  taskId: string;
  queuePosition: number;
}

export interface EnqueueError {
  code: 'queue_full' | 'task_not_found' | 'internal_error';
  message: string;
}

export interface TaskEnqueueService {
  /**
   * Enqueue a task for dispatch.
   *
   * The task MUST already exist in Firestore with status='queued'
   * (set at creation time via codeTaskRepo.create()).
   *
   * This method:
   * 1. Validates the task exists
   * 2. Checks queue capacity (countQueued vs config.queue.maxSize)
   * 3. Sets queuedAt timestamp on the task
   * 4. Sends WhatsApp notification with queue position
   * 5. Returns queue position info
   *
   * If queue is full, marks the task as failed and returns queue_full error.
   */
  enqueue(input: EnqueueTaskInput): Promise<Result<EnqueueResult, EnqueueError>>;
}
