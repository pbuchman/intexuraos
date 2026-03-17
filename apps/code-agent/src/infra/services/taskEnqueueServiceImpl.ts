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
    // 1-indexed for user-facing display ("you are #1 in line")
    const queuePosition = queueCount + 1;
    const estimatedWaitMinutes = Math.min(queuePosition * 5, config.queue.ttlMinutes);

    const notifyResult = await this.whatsappNotifier.notifyTaskQueued(
      userId,
      updateResult.value,
      queuePosition,
      estimatedWaitMinutes,
    );

    if (!notifyResult.ok) {
      this.logger.warn({ taskId, error: notifyResult.error }, 'Failed to send queue notification');
    }

    this.logger.info({ taskId, queuePosition, estimatedWaitMinutes }, 'Task enqueued for dispatch');

    return ok({
      taskId,
      queuePosition,
      estimatedWaitMinutes,
    });
  }
}
