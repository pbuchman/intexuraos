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
  /**
   * Optional override for the `queuedAt` timestamp written to the task document.
   *
   * When omitted, the implementation stamps `new Date()` (current time).
   *
   * Used by `autoRetryTask` (INT-1560 Fix D) to carry forward the original
   * task's `queuedAt` so the retry-chain TTL is measured from the FIRST
   * attempt's queue entry, bounding the entire chain.
   */
  queuedAt?: Date;
}

export interface EnqueueManyTasksInput {
  taskIds: string[];
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

  /**
   * Enqueue multiple already-created queued tasks as one fan-out batch.
   *
   * Intended for complex parent implementation where all child tasks already
   * exist with status='queued'. Implementations may treat queuedAt stamping as
   * best-effort as long as the tasks remain dispatchable via createdAt.
   */
  enqueueMany?(input: EnqueueManyTasksInput): Promise<Result<EnqueueResult[], EnqueueError>>;
}
