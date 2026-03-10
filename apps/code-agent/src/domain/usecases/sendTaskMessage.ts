/**
 * Use case: Send a message to an active or completed code task.
 *
 * Running tasks: message is queued on the worker and delivered when the current attempt completes.
 * Terminal tasks (completed/failed/interrupted/cancelled): task resumes with the message via --continue.
 * Dispatched tasks: message is queued locally in Firestore (pendingUserMessages) until orchestrator picks up.
 * Queued tasks: rejected.
 */

import { Timestamp } from '@google-cloud/firestore';
import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { TaskDispatcherService } from '../services/taskDispatcher.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { StatusMirrorService } from '../services/statusMirrorService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';

export interface SendTaskMessageRequest {
  taskId: string;
  userId: string;
  message: string;
}

export interface SendTaskMessageResult {
  action: 'queued' | 'resumed';
}

export type SendTaskMessageErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'worker_not_configured'
  | 'worker_unavailable'
  | 'worker_error'
  | 'internal_error';

export interface SendTaskMessageError {
  code: SendTaskMessageErrorCode;
  message: string;
}

export interface SendTaskMessageDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  logLineRepo: LogLineRepository;
  taskDispatcher: TaskDispatcherService;
  workerSettingsRepo: WorkerSettingsRepository;
  statusMirrorService: StatusMirrorService;
  whatsappNotifier: WhatsAppNotifier;
}

export async function sendTaskMessage(
  deps: SendTaskMessageDeps,
  request: SendTaskMessageRequest
): Promise<Result<SendTaskMessageResult, SendTaskMessageError>> {
  const { logger, codeTaskRepo, logLineRepo, taskDispatcher, workerSettingsRepo, statusMirrorService, whatsappNotifier } = deps;
  const { taskId, userId, message } = request;

  // Step 1: Load task and validate ownership
  const taskResult = await codeTaskRepo.findByIdForUser(taskId, userId);

  if (!taskResult.ok) {
    logger.warn({ taskId, userId }, 'Task not found for message');
    return err({ code: 'task_not_found', message: `Task ${taskId} not found` });
  }

  const task = taskResult.value;

  // Step 2: Validate task status
  if (task.status === 'queued') {
    logger.warn({ taskId, status: task.status }, 'Cannot send message to task with this status');
    return err({
      code: 'invalid_status',
      message: `Cannot send message to task with status "${task.status}"`,
    });
  }

  // Step 2b: For dispatched tasks, queue message locally without contacting the worker
  if (task.status === 'dispatched') {
    const sequence = Date.now() * 1000;
    const storeResult = await logLineRepo.storeBatch(taskId, [
      { sequence, text: `[user] ${message}`, timestamp: Timestamp.now() },
    ]);
    if (!storeResult.ok) {
      logger.error({ taskId, error: storeResult.error }, 'Failed to store user message log line');
    }

    const allQueued = [...(task.pendingUserMessages ?? []), message];
    const queueUpdateResult = await codeTaskRepo.update(taskId, { pendingUserMessages: allQueued });
    if (!queueUpdateResult.ok) {
      logger.warn({ taskId, error: queueUpdateResult.error }, 'Failed to update pending user messages');
    }

    const statusLogResult = await logLineRepo.storeBatch(taskId, [
      { sequence: sequence + 1, text: '[queued] Message queued — task is awaiting orchestrator pickup', timestamp: Timestamp.now() },
    ]);
    if (!statusLogResult.ok) {
      logger.warn({ taskId, error: statusLogResult.error }, 'Failed to write status log line');
    }

    logger.info({ taskId, action: 'queued', status: 'dispatched' }, 'Message queued for dispatched task');
    return ok({ action: 'queued' });
  }

  // Step 3: Write [user] log line to Firestore
  const sequence = Date.now() * 1000;
  const storeResult = await logLineRepo.storeBatch(taskId, [
    {
      sequence,
      text: `[user] ${message}`,
      timestamp: Timestamp.now(),
    },
  ]);

  if (!storeResult.ok) {
    logger.error({ taskId, error: storeResult.error }, 'Failed to store user message log line');
    // Non-fatal — continue with forwarding even if log write fails
  }

  // Step 4: Look up worker credentials
  const settingsResult = await workerSettingsRepo.getSettings(userId);

  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for message');
    return err({ code: 'internal_error', message: 'Failed to fetch worker settings' });
  }

  const settings = settingsResult.value;
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for messaging');
    return err({
      code: 'worker_not_configured',
      message: 'No workers configured',
    });
  }

  // Find the worker matching the task's workerLocation
  const worker = enabledWorkers.find((w) => w.name === task.workerLocation) ?? enabledWorkers[0];

  /* v8 ignore start -- ts-type: array access with nullish coalescing creates type narrowing branch @preserve */
  if (worker === undefined) {
    return err({ code: 'worker_not_configured', message: 'No workers configured' });
  }
  /* v8 ignore stop @preserve */

  // Step 5: Forward to orchestrator
  const forwardResult = await taskDispatcher.sendMessageToWorker(taskId, message, {
    url: worker.url,
    cfAccessClientId: worker.cfAccessClientId,
    cfAccessClientSecret: worker.cfAccessClientSecret,
    dispatchSigningSecret: worker.dispatchSigningSecret,
  });

  if (!forwardResult.ok) {
    const errorCode = forwardResult.error.code === 'worker_unavailable' ? 'worker_unavailable' : 'worker_error';
    logger.error({ taskId, error: forwardResult.error }, 'Failed to forward message to worker');
    return err({
      code: errorCode,
      message: forwardResult.error.message,
    });
  }

  const { action } = forwardResult.value;
  logger.info({ taskId, action }, 'Message sent to task');

  // Best-effort: write status log lines so the transcript shows what happened
  if (action === 'queued') {
    // Accumulate in Firestore so the queue survives orchestrator restarts
    const allQueued = [...(task.pendingUserMessages ?? []), message];
    const queueUpdateResult = await codeTaskRepo.update(taskId, { pendingUserMessages: allQueued });
    if (!queueUpdateResult.ok) {
      logger.warn({ taskId, error: queueUpdateResult.error }, 'Failed to update pending user messages');
    }

    const statusLogResult = await logLineRepo.storeBatch(taskId, [
      { sequence: sequence + 1, text: '[queued] Message queued \u2014 will be delivered when current work completes', timestamp: Timestamp.now() },
    ]);
    if (!statusLogResult.ok) {
      logger.warn({ taskId, error: statusLogResult.error }, 'Failed to write status log line');
    }
  } else {
    // Clear the accumulated queue and reset task status
    const clearResult = await codeTaskRepo.update(taskId, { status: 'running', error: null, pendingUserMessages: [] });
    if (!clearResult.ok) {
      logger.warn({ taskId, error: clearResult.error }, 'Failed to update task status on resume');
    }

    // Append [resumed] marker — [user] line was already written in Step 3
    const resumeSequence = Date.now() * 1000;
    const statusLogResult = await logLineRepo.storeBatch(taskId, [
      { sequence: resumeSequence, text: `[resumed] Task resuming with your message: ${message}`, timestamp: Timestamp.now() },
    ]);
    if (!statusLogResult.ok) {
      logger.warn({ taskId, error: statusLogResult.error }, 'Failed to write status log line');
    }
  }

  // Best-effort side-effects when task is resumed
  if (action === 'resumed') {
    // Mirror running status to actions inbox
    try {
      await statusMirrorService.mirrorStatus({
        actionId: task.actionId,
        taskStatus: 'running',
        traceId: task.traceId,
      });
    } catch (mirrorError: unknown) {
      logger.warn({ taskId, error: mirrorError }, 'Failed to mirror resumed status');
    }

    // Notify user via WhatsApp
    try {
      await whatsappNotifier.notifyTaskResumed(userId, task);
    } catch (notifyError: unknown) {
      logger.warn({ taskId, error: notifyError }, 'Failed to send resumed notification');
    }
  }

  return ok({ action });
}
