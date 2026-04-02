/**
 * Implementation of TaskEnqueueService (INT-949).
 *
 * Validates queue capacity and stamps queuedAt on the task.
 * Does NOT dispatch — drainTaskQueue handles that.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type {
  TaskEnqueueService,
  EnqueueTaskInput,
  EnqueueManyTasksInput,
  EnqueueResult,
  EnqueueError,
} from '../../domain/services/taskEnqueueService.js';
import { loadConfig } from '../../config.js';

export interface TaskEnqueueServiceImplDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  whatsappNotifier: WhatsAppNotifier;
}

export function createTaskEnqueueService(deps: TaskEnqueueServiceImplDeps): TaskEnqueueService {
  return new TaskEnqueueServiceImpl(deps);
}

export class TaskEnqueueServiceImpl implements TaskEnqueueService {
  private readonly logger: Logger;
  private readonly codeTaskRepo: CodeTaskRepository;
  private readonly whatsappNotifier: WhatsAppNotifier;

  constructor(deps: TaskEnqueueServiceImplDeps) {
    this.logger = deps.logger;
    this.codeTaskRepo = deps.codeTaskRepo;
    this.whatsappNotifier = deps.whatsappNotifier;
  }

  async enqueue(input: EnqueueTaskInput): Promise<Result<EnqueueResult, EnqueueError>> {
    const { taskId, userId } = input;
    const config = loadConfig();

    // Step 1: Verify task exists (findById returns err for both not-found and Firestore errors)
    const findResult = await this.codeTaskRepo.findById(taskId);
    if (!findResult.ok) {
      this.logger.error({ taskId, error: findResult.error }, 'Failed to find task for enqueue');
      return err({ code: 'task_not_found', message: `Task ${taskId} not found or not accessible` });
    }

    // Step 2: Check queue capacity
    const countResult = await this.codeTaskRepo.countQueued();
    if (!countResult.ok) {
      this.logger.error({ error: countResult.error }, 'Failed to count queued tasks');
      return err({ code: 'internal_error', message: 'Failed to check queue capacity' });
    }

    const queueCount = countResult.value;

    if (queueCount >= config.queue.maxSize) {
      // Queue is full — mark task as failed
      await this.codeTaskRepo.update(taskId, {
        status: 'failed',
        error: {
          code: 'queue_full',
          message: `All workers are busy and the queue is full (${String(queueCount)}/${String(config.queue.maxSize)}). Please try again in a few minutes.`,
        },
      });

      this.logger.warn({ taskId, queueCount, maxSize: config.queue.maxSize }, 'Queue full, task failed');
      return err({
        code: 'queue_full',
        message: 'All workers are busy and the queue is full. Please try again in a few minutes.',
      });
    }

    // Step 3: Set queuedAt timestamp
    const updateResult = await this.codeTaskRepo.update(taskId, {
      queuedAt: new Date(),
    });

    if (!updateResult.ok) {
      this.logger.error({ taskId, error: updateResult.error }, 'Failed to update task with queuedAt');
      return err({ code: 'internal_error', message: 'Failed to update task queue timestamp' });
    }

    // Step 4: Send WhatsApp notification (best-effort)
    // countQueued() already includes the current task (created with status:'queued' before enqueue),
    // so queueCount IS the 1-indexed position (INT-977: fix off-by-one).
    const queuePosition = queueCount;

    const notifyResult = await this.whatsappNotifier.notifyTaskQueued(
      userId,
      updateResult.value,
      queuePosition,
    );

    if (!notifyResult.ok) {
      this.logger.warn({ taskId, error: notifyResult.error }, 'Failed to send queue notification');
    }

    this.logger.info({ taskId, queuePosition }, 'Task enqueued for dispatch');

    return ok({
      taskId,
      queuePosition,
    });
  }

  async enqueueMany(input: EnqueueManyTasksInput): Promise<Result<EnqueueResult[], EnqueueError>> {
    const { taskIds, userId } = input;
    if (taskIds.length === 0) {
      return ok([]);
    }

    const config = loadConfig();
    const tasks = [];

    for (const taskId of taskIds) {
      const findResult = await this.codeTaskRepo.findById(taskId);
      if (!findResult.ok) {
        this.logger.error({ taskId, error: findResult.error }, 'Failed to find task for batch enqueue');
        return err({ code: 'task_not_found', message: `Task ${taskId} not found or not accessible` });
      }
      tasks.push(findResult.value);
    }

    const countResult = await this.codeTaskRepo.countQueued();
    if (!countResult.ok) {
      this.logger.error({ error: countResult.error }, 'Failed to count queued tasks for batch enqueue');
      return err({ code: 'internal_error', message: 'Failed to check queue capacity' });
    }

    const queueCount = countResult.value;
    const baseQueueCount = Math.max(0, queueCount - taskIds.length);

    if (queueCount >= config.queue.maxSize) {
      await Promise.all(
        taskIds.map(async (taskId) => {
          await this.codeTaskRepo.update(taskId, {
            status: 'failed',
            error: {
              code: 'queue_full',
              message: `All workers are busy and the queue is full (${String(queueCount)}/${String(config.queue.maxSize)}). Please try again in a few minutes.`,
            },
          });
        }),
      );

      this.logger.warn(
        { taskIds, queueCount, maxSize: config.queue.maxSize },
        'Queue full, batch enqueue failed',
      );
      return err({
        code: 'queue_full',
        message: 'All workers are busy and the queue is full. Please try again in a few minutes.',
      });
    }

    const results: EnqueueResult[] = [];

    for (const [index, task] of tasks.entries()) {
      const queuedAt = new Date();
      const updateResult = await this.codeTaskRepo.update(task.id, { queuedAt });
      const effectiveTask = updateResult.ok ? updateResult.value : task;
      if (!updateResult.ok) {
        this.logger.warn({ taskId: task.id, error: updateResult.error }, 'Failed to update task with queuedAt during batch enqueue');
      }

      const queuePosition = baseQueueCount + index + 1;
      const notifyResult = await this.whatsappNotifier.notifyTaskQueued(userId, effectiveTask, queuePosition);
      if (!notifyResult.ok) {
        this.logger.warn({ taskId: task.id, error: notifyResult.error }, 'Failed to send queue notification during batch enqueue');
      }

      this.logger.info({ taskId: task.id, queuePosition }, 'Task enqueued for dispatch as part of batch');
      results.push({ taskId: task.id, queuePosition });
    }

    return ok(results);
  }
}
