/**
 * Use case: Drain retry queue by re-dispatching oldest failed dispatch.
 *
 * Called by Cloud Scheduler via POST /internal/drain-queue, before drainTaskQueue.
 * Retries webhook dispatches that failed with transient errors.
 */

import { Timestamp } from '@google-cloud/firestore';
import { ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { DispatchRetry } from '../models/dispatchRetry.js';
import type { DispatchRetryRepository } from '../repositories/dispatchRetryRepository.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { StatusMirrorService } from '../services/statusMirrorService.js';
import { loadConfig } from '../../config.js';
import { isRetryableErrorCode } from '../utils/retryableErrors.js';
import { generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
import { buildLockCleanups, type LockCleanupInfo } from '../utils/prTaskLock.js';
import { ensureDispatchLabelsForAgentType, resolveTaskAgentType } from '../utils/taskRouting.js';
import { archiveRetriedTaskAfterDispatch } from '../utils/archiveRetriedTaskAfterDispatch.js';

// In-memory guard for single-instance environments
let isDrainingRetries = false;

// Exported for testing
export function _resetRetryDrainGuard(): void {
  isDrainingRetries = false;
}

export interface DrainRetryQueueResult {
  action: 'dispatched' | 'message_sent' | 'expired' | 'exhausted' | 'retry_failed' | 'failed' | 'empty' | 'skipped';
  taskId?: string;
  locksToCleanup?: LockCleanupInfo[];
}

export interface DrainRetryQueueError {
  code: 'internal_error' | 'concurrent_drain';
  message: string;
}

export interface DrainRetryQueueDeps {
  logger: Logger;
  dispatchRetryRepo: DispatchRetryRepository;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
  linearAgentClient: LinearAgentClient;
  whatsappNotifier: WhatsAppNotifier;
  workerSettingsRepo: WorkerSettingsRepository;
  logLineRepo: LogLineRepository;
  statusMirrorService: StatusMirrorService;
}

export async function drainRetryQueue(
  deps: DrainRetryQueueDeps
): Promise<Result<DrainRetryQueueResult, DrainRetryQueueError>> {
  const { logger, dispatchRetryRepo, codeTaskRepo, whatsappNotifier } = deps;
  const config = loadConfig();

  // Fast-path guard
  if (isDrainingRetries) {
    logger.info({ reason: 'concurrent' }, 'Retry drain already in progress, skipping');
    return ok({ action: 'skipped' });
  }

  isDrainingRetries = true;
  try {
    // Step 1: Find oldest retry entry
    const findResult = await dispatchRetryRepo.findOldest();
    if (!findResult.ok) {
      logger.error({ error: findResult.error }, 'Failed to find oldest retry entry');
      return ok({ action: 'failed' });
    }

    const entry = findResult.value;
    if (entry === null) {
      logger.info({ queue: 'empty' }, 'No retry entries to drain');
      return ok({ action: 'empty' });
    }

    logger.info({ retryId: entry.id, type: entry.type, attempts: entry.attempts }, 'Processing retry entry');

    // Step 2: TTL check
    const createdAt = entry.createdAt.toDate();
    const ttlMs = entry.ttlMinutes * 60 * 1000;
    const now = Date.now();

    if (now - createdAt.getTime() > ttlMs) {
      logger.warn({ retryId: entry.id, createdAt }, 'Retry entry expired');
      await dispatchRetryRepo.delete(entry.id);

      if (entry.type === 'new_task' && entry.taskId !== undefined) {
        await codeTaskRepo.update(entry.taskId, {
          status: 'failed',
          error: { code: 'retry_expired', message: `Dispatch retry expired after ${String(entry.ttlMinutes)} minutes` },
        });
        const taskResult = await codeTaskRepo.findById(entry.taskId);
        if (taskResult.ok) {
          const locksToCleanup = buildLockCleanups(taskResult.value);
          // Notify user
          const userId = taskResult.value.userId;
          await whatsappNotifier.notifyDispatchRetryExhausted(userId, {
            repository: entry.repository,
            pullRequestNumber: entry.pullRequestNumber,
            lastError: `Expired after ${String(entry.ttlMinutes)} minutes: ${entry.lastError}`,
          });
          return ok({ action: 'expired', taskId: entry.taskId, locksToCleanup });
        }
      }

      // task_message or task lookup failed: notify if we have userId
      if (entry.userId !== undefined) {
        await whatsappNotifier.notifyDispatchRetryExhausted(entry.userId, {
          repository: entry.repository,
          pullRequestNumber: entry.pullRequestNumber,
          lastError: `Expired after ${String(entry.ttlMinutes)} minutes: ${entry.lastError}`,
        });
      }

      return ok({ action: 'expired', ...(entry.taskId !== undefined && { taskId: entry.taskId }) });
    }

    // Step 3: Max attempts check
    if (entry.attempts >= entry.maxAttempts) {
      logger.warn({ retryId: entry.id, attempts: entry.attempts }, 'Retry entry exhausted max attempts');
      await dispatchRetryRepo.delete(entry.id);

      if (entry.type === 'new_task' && entry.taskId !== undefined) {
        await codeTaskRepo.update(entry.taskId, {
          status: 'failed',
          error: { code: 'retry_exhausted', message: `Dispatch retry exhausted after ${String(entry.attempts)} attempts: ${entry.lastError}` },
        });
        const taskResult = await codeTaskRepo.findById(entry.taskId);
        if (taskResult.ok) {
          const locksToCleanup = buildLockCleanups(taskResult.value);
          await whatsappNotifier.notifyDispatchRetryExhausted(taskResult.value.userId, {
            repository: entry.repository,
            pullRequestNumber: entry.pullRequestNumber,
            lastError: entry.lastError,
          });
          return ok({ action: 'exhausted', taskId: entry.taskId, locksToCleanup });
        }
      }

      if (entry.userId !== undefined) {
        await whatsappNotifier.notifyDispatchRetryExhausted(entry.userId, {
          repository: entry.repository,
          pullRequestNumber: entry.pullRequestNumber,
          lastError: entry.lastError,
        });
      }

      return ok({ action: 'exhausted', ...(entry.taskId !== undefined && { taskId: entry.taskId }) });
    }

    // Step 4: Branch on type
    if (entry.type === 'new_task') {
      return await handleNewTaskRetry(deps, entry, config);
    }

    return await handleTaskMessageRetry(deps, entry);

  } finally {
    isDrainingRetries = false;
  }
}

async function handleNewTaskRetry(
  deps: DrainRetryQueueDeps,
  entry: DispatchRetry,
  config: ReturnType<typeof loadConfig>,
): Promise<Result<DrainRetryQueueResult, DrainRetryQueueError>> {
  const { logger, dispatchRetryRepo, codeTaskRepo, taskDispatcher, linearAgentClient, whatsappNotifier, workerSettingsRepo } = deps;

  if (entry.taskId === undefined) {
    logger.error({ retryId: entry.id }, 'new_task retry missing taskId');
    await dispatchRetryRepo.delete(entry.id);
    return ok({ action: 'failed' });
  }

  // Find the task
  const taskResult = await codeTaskRepo.findById(entry.taskId);
  if (!taskResult.ok) {
    logger.error({ taskId: entry.taskId, error: taskResult.error }, 'Failed to find task for retry');
    await dispatchRetryRepo.delete(entry.id);
    return ok({ action: 'failed' });
  }

  const task = taskResult.value;

  // Fetch worker credentials
  const settingsResult = await workerSettingsRepo.getSettings(task.userId);
  if (!settingsResult.ok || settingsResult.value === null) {
    logger.error({ userId: task.userId }, 'Failed to fetch worker settings for retry');
    await dispatchRetryRepo.update(entry.id, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: 'Failed to fetch worker settings',
    });
    return ok({ action: 'retry_failed', taskId: entry.taskId });
  }

  const settings = settingsResult.value;
  const enabledWorkers = settings.workers.filter((w) => w.enabled);

  if (enabledWorkers.length === 0) {
    logger.warn({ userId: task.userId }, 'No enabled workers during retry');
    await dispatchRetryRepo.update(entry.id, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: 'No enabled workers',
    });
    return ok({ action: 'retry_failed', taskId: entry.taskId });
  }

  const workerCredentials: DispatchWorkerCredentials = {
    workers: enabledWorkers.map((w) => ({
      name: w.name,
      url: w.url,
      cfAccessClientId: w.cfAccessClientId,
      cfAccessClientSecret: w.cfAccessClientSecret,
      dispatchSigningSecret: w.dispatchSigningSecret,
    })),
  };

  // Fetch fresh Linear metadata
  let linearIssueLabels: string[] = [];
  let hasChildren = false;

  if (task.linearIssueId !== undefined) {
    const validateResult = await linearAgentClient.validateIssue({
      userId: task.userId,
      identifier: task.linearIssueId,
    });
    if (validateResult.ok) {
      linearIssueLabels = validateResult.value.labels;
      hasChildren = validateResult.value.childCount > 0;
    }
  }

  const agentType = resolveTaskAgentType(task, linearIssueLabels);
  const dispatchLabels = ensureDispatchLabelsForAgentType(linearIssueLabels, agentType);
  const webhookUrl = `${config.serviceUrl}/internal/webhooks/task-complete`;

  // Attempt dispatch
  const dispatchResult = await taskDispatcher.dispatch({
    taskId: task.id,
    prompt: task.sanitizedPrompt,
    systemPromptHash: task.systemPromptHash,
    repository: task.repository,
    baseBranch: task.baseBranch,
    workerType: task.workerType,
    webhookUrl,
    webhookSecret: task.webhookSecret ?? '',
    traceId: task.traceId,
    workerCredentials,
    linearIssueLabels: dispatchLabels,
    hasChildren,
    agentType,
    ...(task.prNumber !== undefined && task.prBranch !== undefined && {
      continuationPrNumber: task.prNumber,
      continuationPrBranch: task.prBranch,
    }),
    ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
    ...(task.reviewTypes !== undefined && { reviewTypes: task.reviewTypes }),
    ...(task.prNumber !== undefined && { prNumber: task.prNumber }),
  });

  if (!dispatchResult.ok) {
    const dispatchError = dispatchResult.error;

    // Note: at_capacity is NOT retryable at entry *creation* (the regular task queue handles queuing),
    // but IS retryable during *drain* — if a retry entry already exists and the worker is at capacity,
    // we should increment and try again rather than permanently failing the task.
    if (isRetryableErrorCode(dispatchError.code) || dispatchError.code === 'at_capacity') {
      await dispatchRetryRepo.update(entry.id, {
        attempts: entry.attempts + 1,
        lastAttemptAt: new Date(),
        lastError: dispatchError.message,
      });
      logger.info({ retryId: entry.id, attempts: entry.attempts + 1 }, 'Retry dispatch failed, will retry again');
      return ok({ action: 'retry_failed', taskId: entry.taskId });
    }

    // Non-retryable — fail permanently
    await dispatchRetryRepo.delete(entry.id);
    await codeTaskRepo.update(entry.taskId, {
      status: 'failed',
      error: { code: dispatchError.code, message: `Retry dispatch failed: ${dispatchError.message}` },
    });
    const locksToCleanup = buildLockCleanups(task);
    return ok({ action: 'failed', taskId: entry.taskId, locksToCleanup });
  }

  // Success! Delete retry entry and update task
  await dispatchRetryRepo.delete(entry.id);

  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(entry.taskId, {
    status: 'dispatched',
    dispatchedAt: new Date(),
    workerLocation: dispatchResult.value.workerLocation,
    cancelNonce,
    cancelNonceExpiresAt,
  });

  if (updateResult.ok) {
    await archiveRetriedTaskAfterDispatch({
      logger,
      codeTaskRepo,
      retryTaskId: task.id,
      warningMessage: 'Failed to archive original task after retry drain dispatch',
      ...(task.retriedFrom !== undefined && { retriedFrom: task.retriedFrom }),
    });
    await whatsappNotifier.notifyTaskStarted(task.userId, updateResult.value);
  }

  logger.info({ taskId: entry.taskId, workerLocation: dispatchResult.value.workerLocation }, 'Retry dispatch successful');
  return ok({ action: 'dispatched', taskId: entry.taskId });
}

async function handleTaskMessageRetry(
  deps: DrainRetryQueueDeps,
  entry: DispatchRetry,
): Promise<Result<DrainRetryQueueResult, DrainRetryQueueError>> {
  const { logger, dispatchRetryRepo, workerSettingsRepo, taskDispatcher, logLineRepo } = deps;

  if (entry.userId === undefined || entry.taskId === undefined || entry.message === undefined) {
    logger.error({ retryId: entry.id }, 'task_message retry missing required fields');
    await dispatchRetryRepo.delete(entry.id);
    return ok({ action: 'failed' });
  }

  // Fetch worker credentials
  const settingsResult = await workerSettingsRepo.getSettings(entry.userId);
  if (!settingsResult.ok || settingsResult.value === null) {
    await dispatchRetryRepo.update(entry.id, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: 'Failed to fetch worker settings',
    });
    return ok({ action: 'retry_failed', taskId: entry.taskId });
  }

  const settings = settingsResult.value;
  const enabledWorkers = settings.workers.filter((w) => w.enabled);
  const worker = enabledWorkers[0];

  if (worker === undefined) {
    await dispatchRetryRepo.update(entry.id, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: 'No enabled workers',
    });
    return ok({ action: 'retry_failed', taskId: entry.taskId });
  }

  // Send message
  const sendResult = await taskDispatcher.sendMessageToWorker(entry.taskId, entry.message, {
    url: worker.url,
    cfAccessClientId: worker.cfAccessClientId,
    cfAccessClientSecret: worker.cfAccessClientSecret,
    dispatchSigningSecret: worker.dispatchSigningSecret,
  });

  if (!sendResult.ok) {
    if (isRetryableErrorCode(sendResult.error.code)) {
      await dispatchRetryRepo.update(entry.id, {
        attempts: entry.attempts + 1,
        lastAttemptAt: new Date(),
        lastError: sendResult.error.message,
      });
      logger.info({ retryId: entry.id, attempts: entry.attempts + 1 }, 'Retry message send failed, will retry again');
      return ok({ action: 'retry_failed', taskId: entry.taskId });
    }

    // Non-retryable
    await dispatchRetryRepo.delete(entry.id);
    logger.warn({ retryId: entry.id, error: sendResult.error }, 'Message retry failed permanently');
    return ok({ action: 'failed', taskId: entry.taskId });
  }

  // Success
  await dispatchRetryRepo.delete(entry.id);

  // Write [resumed] log line
  const sequence = Date.now() * 1000;
  await logLineRepo.storeBatch(entry.taskId, [
    { sequence, text: `[resumed] Message delivered via retry queue: ${entry.message}`, timestamp: Timestamp.now() },
  ]);

  logger.info({ taskId: entry.taskId }, 'Retry message delivery successful');
  return ok({ action: 'message_sent', taskId: entry.taskId });
}
