/**
 * Use case: Drain retry queue by re-dispatching oldest failed dispatch.
 *
 * Called by Cloud Scheduler via POST /internal/drain-queue, before drainTaskQueue.
 * Retries webhook dispatches that failed with transient errors.
 */

import { Timestamp } from '@google-cloud/firestore';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { CodeTask } from '../models/codeTask.js';
import type { DispatchRetry } from '../models/dispatchRetry.js';
import type { DispatchRetryRepository } from '../repositories/dispatchRetryRepository.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { StatusMirrorService } from '../services/statusMirrorService.js';
import type { CodeTaskDispatchStatusService } from '../services/codeTaskDispatchStatusService.js';
import {
  classifyCodeTaskDispatchability,
} from '../services/codeTaskDispatchBlockers.js';
import {
  buildDispatchStatusForProblem,
  dispatchProblemFromBlocker,
  dispatchProblemFromError,
  notifyDispatchProblemForTask,
  retryExhaustedDispatchProblem,
  retryExpiredDispatchProblem,
  taskErrorFromDispatchStatus,
  type DispatchBlocker,
  type DispatchProblem,
} from '../services/codeTaskDispatchProblems.js';
import { loadConfig } from '../../config.js';
import { isRetryableErrorCode } from '../utils/retryableErrors.js';
import { generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
import { buildLockCleanups, type LockCleanupInfo } from '../utils/prTaskLock.js';
import { ensureDispatchLabelsForAgentType, resolveTaskAgentType } from '../utils/taskRouting.js';
import { archiveRetriedTaskAfterDispatch } from '../utils/archiveRetriedTaskAfterDispatch.js';
import { isMemoryEligibleAgent } from '../utils/memoryEligibility.js';
import {
  prepareExecutionMemoryContext,
  toDispatchExecutionMemoryContext,
  type PrepareExecutionMemoryResources,
} from './prepareExecutionMemoryContext.js';
import { isStaleTaskError } from '../services/gitHubDispatchService.js';
import { buildTaskCompleteWebhookUrl } from '../services/codeTaskCallbackUrls.js';
import type { SendTaskMessageErrorCode } from './sendTaskMessage.js';

const RETRY_PROCESSING_LEASE_MS = 5 * 60 * 1000;

async function recordDispatchBlockedForRetry(
  deps: Pick<DrainRetryQueueDeps, 'logger' | 'codeTaskDispatchStatusService'>,
  task: CodeTask,
  blocker: DispatchBlocker
): Promise<void> {
  if (deps.codeTaskDispatchStatusService === undefined) {
    return;
  }

  try {
    await deps.codeTaskDispatchStatusService.recordDispatchBlocked({
      userId: task.userId,
      workerType: task.workerType,
      blocker,
      affectedTaskCount: 1,
      exampleTaskIds: [task.id],
    });
  } catch (error) {
    deps.logger.warn(
      { taskId: task.id, reason: blocker.reason, error },
      'Failed to record code task retry dispatch blocker status'
    );
  }
}

async function failRetryTaskForDispatchProblem(
  deps: Pick<DrainRetryQueueDeps, 'logger' | 'codeTaskRepo' | 'whatsappNotifier'>,
  task: CodeTask,
  problem: DispatchProblem,
): Promise<Result<void, DrainRetryQueueError>> {
  const dispatchStatus = buildDispatchStatusForProblem({
    task,
    problem,
  });
  const updateResult = await deps.codeTaskRepo.update(task.id, {
    status: 'failed',
    error: taskErrorFromDispatchStatus(dispatchStatus),
    dispatchStatus,
  });
  if (!updateResult.ok) {
    deps.logger.error(
      { taskId: task.id, reason: problem.reason, error: updateResult.error },
      'Failed to persist failed status during retry dispatch blocker handling'
    );
    return err({
      code: 'internal_error',
      message: 'Failed to persist retry dispatch failure status',
    });
  }
  await notifyDispatchProblemForTask({
    task,
    dispatchStatus,
    problem,
    whatsappNotifier: deps.whatsappNotifier,
    codeTaskRepo: deps.codeTaskRepo,
    logger: deps.logger,
    affectedTaskCount: 1,
  });
  return ok(undefined);
}

async function recordRetryTaskDispatchProblem(
  deps: Pick<DrainRetryQueueDeps, 'logger' | 'codeTaskRepo' | 'whatsappNotifier'>,
  task: CodeTask,
  problem: DispatchProblem,
): Promise<Result<void, DrainRetryQueueError>> {
  const dispatchStatus = buildDispatchStatusForProblem({
    task,
    problem,
  });
  const updateResult = await deps.codeTaskRepo.update(task.id, {
    status: 'queued',
    dispatchStatus,
  });
  if (!updateResult.ok) {
    deps.logger.warn(
      { taskId: task.id, reason: problem.reason, error: updateResult.error },
      'Failed to persist task-level retry dispatch blocker status'
    );
    return err({
      code: 'internal_error',
      message: 'Failed to persist retry dispatch status',
    });
  }
  await notifyDispatchProblemForTask({
    task,
    dispatchStatus,
    problem,
    whatsappNotifier: deps.whatsappNotifier,
    codeTaskRepo: deps.codeTaskRepo,
    logger: deps.logger,
    affectedTaskCount: 1,
  });
  return ok(undefined);
}

async function resolveDispatchBlockersForRetry(
  deps: Pick<DrainRetryQueueDeps, 'logger' | 'codeTaskDispatchStatusService'>,
  task: CodeTask
): Promise<void> {
  if (deps.codeTaskDispatchStatusService === undefined) {
    return;
  }

  try {
    await deps.codeTaskDispatchStatusService.resolveDispatchBlockers({
      userId: task.userId,
      workerType: task.workerType,
    });
  } catch (error) {
    deps.logger.warn(
      { taskId: task.id, workerType: task.workerType, error },
      'Failed to resolve code task retry dispatch blocker statuses'
    );
  }
}

function isTaskNotFoundError(error: { code: string }): boolean {
  return error.code === 'NOT_FOUND' || error.code === 'not_found';
}

async function deleteRetryEntryOrError(
  deps: Pick<DrainRetryQueueDeps, 'logger' | 'dispatchRetryRepo'>,
  entry: DispatchRetry,
  logMessage: string,
  errorMessage: string,
): Promise<Result<void, DrainRetryQueueError>> {
  const deleteResult = await deps.dispatchRetryRepo.delete(entry.id);
  if (!deleteResult.ok) {
    deps.logger.error({ retryId: entry.id, error: deleteResult.error }, logMessage);
    return err({ code: 'internal_error', message: errorMessage });
  }
  return ok(undefined);
}

async function claimRetryEntryForProcessing(
  deps: Pick<DrainRetryQueueDeps, 'logger' | 'dispatchRetryRepo'>,
  entry: DispatchRetry,
): Promise<Result<boolean, DrainRetryQueueError>> {
  const staleBefore = new Date(Date.now() - RETRY_PROCESSING_LEASE_MS);
  const claimResult = await deps.dispatchRetryRepo.claimForProcessing(entry.id, staleBefore);
  if (!claimResult.ok) {
    deps.logger.error({ retryId: entry.id, error: claimResult.error }, 'Failed to claim retry entry for processing');
    return err({ code: 'internal_error', message: 'Failed to claim retry entry for processing' });
  }
  return ok(claimResult.value);
}

async function updateRetryEntryOrError(
  deps: Pick<DrainRetryQueueDeps, 'logger' | 'dispatchRetryRepo'>,
  entry: DispatchRetry,
  fields: {
    attempts: number;
    lastAttemptAt: Date;
    lastError: string;
  },
): Promise<Result<void, DrainRetryQueueError>> {
  const updateResult = await deps.dispatchRetryRepo.update(entry.id, {
    ...fields,
    processingStartedAt: null,
  });
  if (!updateResult.ok) {
    deps.logger.error({ retryId: entry.id, error: updateResult.error }, 'Failed to update retry entry');
    return err({ code: 'internal_error', message: 'Failed to update retry entry' });
  }
  return ok(undefined);
}

// In-memory guard for single-instance environments
let isDrainingRetries = false;

// Exported for testing
export function _resetRetryDrainGuard(): void {
  isDrainingRetries = false;
}

export interface DrainRetryQueueResult {
  action: 'dispatched' | 'message_sent' | 'expired' | 'exhausted' | 'retry_failed' | 'failed' | 'empty' | 'skipped' | 'stale_task_fallback';
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
  codeTaskDispatchStatusService?: CodeTaskDispatchStatusService;
  executionMemory?: PrepareExecutionMemoryResources;
  userServiceClient?: Pick<UserServiceClient, 'getLlmClient'>;
  createTaskForPRFn?: (request: {
    repository: string;
    prNumber: number;
    senderLogin: string;
    comment: string;
    eventId: string;
    prTitle?: string;
    baseBranch?: string;
  }) => Promise<Result<{ taskId: string }, { code: string; message: string }>>;
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

    const claimResult = await claimRetryEntryForProcessing(deps, entry);
    if (!claimResult.ok) {
      return err(claimResult.error);
    }
    if (!claimResult.value) {
      logger.info({ retryId: entry.id }, 'Retry entry is already claimed by another drain');
      return ok({ action: 'skipped', ...(entry.taskId !== undefined && { taskId: entry.taskId }) });
    }

    // Step 2: TTL check
    const createdAt = entry.createdAt.toDate();
    const ttlMs = entry.ttlMinutes * 60 * 1000;
    const now = Date.now();

    if (now - createdAt.getTime() > ttlMs) {
      logger.warn({ retryId: entry.id, createdAt }, 'Retry entry expired');

      if (entry.type === 'new_task' && entry.taskId !== undefined) {
        const taskResult = await codeTaskRepo.findById(entry.taskId);
        if (taskResult.ok) {
          const problem = retryExpiredDispatchProblem(entry.ttlMinutes);
          const dispatchStatus = buildDispatchStatusForProblem({ task: taskResult.value, problem });
          const updateResult = await codeTaskRepo.update(entry.taskId, {
            status: 'failed',
            error: { code: 'retry_expired', message: problem.message },
            dispatchStatus,
          });
          if (!updateResult.ok) {
            logger.error(
              { taskId: entry.taskId, error: updateResult.error },
              'Failed to persist retry expiry task status'
            );
            return err({ code: 'internal_error', message: 'Failed to persist retry dispatch failure status' });
          }
          await notifyDispatchProblemForTask({
            task: taskResult.value,
            dispatchStatus,
            problem,
            whatsappNotifier,
            codeTaskRepo,
            logger,
            affectedTaskCount: 1,
          });
          const deleteResult = await dispatchRetryRepo.delete(entry.id);
          if (!deleteResult.ok) {
            logger.error({ retryId: entry.id, error: deleteResult.error }, 'Failed to delete expired retry entry');
            return err({ code: 'internal_error', message: 'Failed to delete expired retry entry' });
          }
          const locksToCleanup = buildLockCleanups(taskResult.value);
          return ok({ action: 'expired', taskId: entry.taskId, locksToCleanup });
        }
        if (!isTaskNotFoundError(taskResult.error)) {
          logger.error({ taskId: entry.taskId, error: taskResult.error }, 'Failed to find expired retry task');
          return err({ code: 'internal_error', message: 'Failed to find expired retry task' });
        }
      }

      const deleteResult = await dispatchRetryRepo.delete(entry.id);
      if (!deleteResult.ok) {
        logger.error({ retryId: entry.id, error: deleteResult.error }, 'Failed to delete expired retry entry');
        return err({ code: 'internal_error', message: 'Failed to delete expired retry entry' });
      }

      if (entry.type === 'new_task') {
        logger.warn(
          { retryId: entry.id, taskId: entry.taskId },
          'Expired new-task retry target was not found; skipping task-level dispatch notification'
        );
        return ok({ action: 'expired', ...(entry.taskId !== undefined && { taskId: entry.taskId }) });
      }

      if (entry.userId !== undefined) {
        const notifyResult = await whatsappNotifier.notifyDispatchRetryExhausted(entry.userId, {
          repository: entry.repository,
          pullRequestNumber: entry.pullRequestNumber,
          lastError: `Expired after ${String(entry.ttlMinutes)} minutes: ${entry.lastError}`,
        });
        if (!notifyResult.ok) {
          logger.warn(
            { retryId: entry.id, userId: entry.userId, error: notifyResult.error },
            'Failed to notify user about expired message retry'
          );
        }
      }

      return ok({ action: 'expired', ...(entry.taskId !== undefined && { taskId: entry.taskId }) });
    }

    // Step 3: Max attempts check
    if (entry.attempts >= entry.maxAttempts) {
      logger.warn({ retryId: entry.id, attempts: entry.attempts }, 'Retry entry exhausted max attempts');

      if (entry.type === 'new_task' && entry.taskId !== undefined) {
        const taskResult = await codeTaskRepo.findById(entry.taskId);
        if (taskResult.ok) {
          const problem = retryExhaustedDispatchProblem(entry.attempts, entry.lastError);
          const dispatchStatus = buildDispatchStatusForProblem({ task: taskResult.value, problem });
          const updateResult = await codeTaskRepo.update(entry.taskId, {
            status: 'failed',
            error: { code: 'retry_exhausted', message: problem.message },
            dispatchStatus,
          });
          if (!updateResult.ok) {
            logger.error(
              { taskId: entry.taskId, error: updateResult.error },
              'Failed to persist retry exhaustion task status'
            );
            return err({ code: 'internal_error', message: 'Failed to persist retry dispatch failure status' });
          }
          await notifyDispatchProblemForTask({
            task: taskResult.value,
            dispatchStatus,
            problem,
            whatsappNotifier,
            codeTaskRepo,
            logger,
            affectedTaskCount: 1,
          });
          const deleteResult = await dispatchRetryRepo.delete(entry.id);
          if (!deleteResult.ok) {
            logger.error({ retryId: entry.id, error: deleteResult.error }, 'Failed to delete exhausted retry entry');
            return err({ code: 'internal_error', message: 'Failed to delete exhausted retry entry' });
          }
          const locksToCleanup = buildLockCleanups(taskResult.value);
          return ok({ action: 'exhausted', taskId: entry.taskId, locksToCleanup });
        }
        if (!isTaskNotFoundError(taskResult.error)) {
          logger.error({ taskId: entry.taskId, error: taskResult.error }, 'Failed to find exhausted retry task');
          return err({ code: 'internal_error', message: 'Failed to find exhausted retry task' });
        }
      }

      const deleteResult = await dispatchRetryRepo.delete(entry.id);
      if (!deleteResult.ok) {
        logger.error({ retryId: entry.id, error: deleteResult.error }, 'Failed to delete exhausted retry entry');
        return err({ code: 'internal_error', message: 'Failed to delete exhausted retry entry' });
      }

      if (entry.type === 'new_task') {
        logger.warn(
          { retryId: entry.id, taskId: entry.taskId },
          'Exhausted new-task retry target was not found; skipping task-level dispatch notification'
        );
        return ok({ action: 'exhausted', ...(entry.taskId !== undefined && { taskId: entry.taskId }) });
      }

      if (entry.userId !== undefined) {
        const notifyResult = await whatsappNotifier.notifyDispatchRetryExhausted(entry.userId, {
          repository: entry.repository,
          pullRequestNumber: entry.pullRequestNumber,
          lastError: entry.lastError,
        });
        if (!notifyResult.ok) {
          logger.warn(
            { retryId: entry.id, userId: entry.userId, error: notifyResult.error },
            'Failed to notify user about exhausted message retry'
          );
        }
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
  const { logger, codeTaskRepo, taskDispatcher, linearAgentClient, whatsappNotifier, workerSettingsRepo } = deps;

  if (entry.taskId === undefined) {
    logger.error({ retryId: entry.id }, 'new_task retry missing taskId');
    const deleteResult = await deleteRetryEntryOrError(
      deps,
      entry,
      'Failed to delete malformed new-task retry entry',
      'Failed to delete malformed new-task retry entry',
    );
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }
    return ok({ action: 'failed' });
  }

  // Find the task
  const taskResult = await codeTaskRepo.findById(entry.taskId);
  if (!taskResult.ok) {
    logger.error({ taskId: entry.taskId, error: taskResult.error }, 'Failed to find task for retry');
    if (!isTaskNotFoundError(taskResult.error)) {
      return err({ code: 'internal_error', message: 'Failed to find task for retry' });
    }
    const deleteResult = await deleteRetryEntryOrError(
      deps,
      entry,
      'Failed to delete retry entry after missing task lookup',
      'Failed to delete retry entry after missing task lookup',
    );
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }
    return ok({ action: 'failed' });
  }

  const task = taskResult.value;
  if (task.status !== 'queued') {
    logger.warn(
      { retryId: entry.id, taskId: task.id, status: task.status },
      'Deleting stale new-task retry entry for task that is no longer queued'
    );
    const deleteResult = await deleteRetryEntryOrError(
      deps,
      entry,
      'Failed to delete stale new-task retry entry',
      'Failed to delete stale new-task retry entry',
    );
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }
    return ok({ action: 'failed', taskId: entry.taskId });
  }

  // Fetch worker credentials
  const settingsResult = await workerSettingsRepo.getSettings(task.userId);
  if (!settingsResult.ok) {
    logger.error({ userId: task.userId }, 'Failed to fetch worker settings for retry');
    const updateResult = await updateRetryEntryOrError(deps, entry, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: 'Failed to fetch worker settings',
    });
    if (!updateResult.ok) {
      return err(updateResult.error);
    }
    return ok({ action: 'retry_failed', taskId: entry.taskId });
  }

  const enabledWorkers = settingsResult.value?.workers.filter((w) => w.enabled) ?? [];

  if (enabledWorkers.length === 0) {
    const dispatchability = classifyCodeTaskDispatchability({
      workerType: task.workerType,
      workers: enabledWorkers,
      healthByWorkerName: {},
    }) as DispatchBlocker;
    await recordDispatchBlockedForRetry(deps, task, dispatchability);
    logger.warn({ userId: task.userId }, 'No enabled workers during retry');
    const failResult = await failRetryTaskForDispatchProblem(deps, task, dispatchProblemFromBlocker(dispatchability));
    if (!failResult.ok) {
      return err(failResult.error);
    }
    const deleteResult = await deleteRetryEntryOrError(
      deps,
      entry,
      'Failed to delete retry entry after no enabled workers',
      'Failed to delete retry entry after no enabled workers',
    );
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }
    return ok({ action: 'failed', taskId: entry.taskId, locksToCleanup: buildLockCleanups(task) });
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
  const webhookUrl = buildTaskCompleteWebhookUrl(config.codeTaskCallbackBaseUrl);
  let taskExecutionMemoryContext = task.executionMemoryContext;

  if (
    config.executionMemoryEnabled
    && isMemoryEligibleAgent(agentType)
    && taskExecutionMemoryContext === undefined
  ) {
    let userLlmClient: LlmGenerateClient | undefined;
    if (deps.userServiceClient !== undefined) {
      const llmResult = await deps.userServiceClient.getLlmClient(task.userId);
      if (llmResult.ok) {
        userLlmClient = llmResult.value;
      } else {
        logger.warn({ userId: task.userId, error: llmResult.error }, 'Failed to resolve user LLM client for execution memory');
      }
    }

    taskExecutionMemoryContext = await prepareExecutionMemoryContext({
      task,
      logger,
      linearAgentClient,
      queryClient: userLlmClient,
      embeddingClient: deps.executionMemory?.embeddingClient,
      executionMemoryRepo: deps.executionMemory?.executionMemoryRepo,
      executionMemoryApplicationRepo: deps.executionMemory?.executionMemoryApplicationRepo,
      agentType,
    });

    if (taskExecutionMemoryContext?.status === 'error') {
      logger.warn(
        {
          taskId: entry.taskId,
          errorCode: taskExecutionMemoryContext.errorCode,
          errorMessage: taskExecutionMemoryContext.errorMessage,
        },
        'Execution memory retrieval returned error status'
      );
    }

    const memoryUpdateResult = await codeTaskRepo.update(entry.taskId, {
      executionMemoryContext: taskExecutionMemoryContext,
    });

    if (!memoryUpdateResult.ok) {
      logger.warn(
        { taskId: entry.taskId, error: memoryUpdateResult.error },
        'Failed to persist execution memory context before dispatch'
      );
    }
  }

  const dispatchExecutionMemoryContext = toDispatchExecutionMemoryContext(taskExecutionMemoryContext);

  // Atomic queued->dispatched claim before the network call. The retry-row
  // processing lease prevents duplicate retry processors, and this task claim
  // prevents duplicate worker dispatch if another path races on the same task.
  const taskClaimResult = await codeTaskRepo.claimForDispatch(task.id);
  if (!taskClaimResult.ok) {
    logger.error({ taskId: task.id, error: taskClaimResult.error }, 'Failed to claim retry task for dispatch');
    return err({ code: 'internal_error', message: 'Failed to claim retry task for dispatch' });
  }
  if (!taskClaimResult.value) {
    logger.info({ retryId: entry.id, taskId: task.id }, 'Retry task was claimed by another dispatcher or is no longer queued');
    return ok({ action: 'skipped', taskId: entry.taskId });
  }

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
    ...(dispatchExecutionMemoryContext !== undefined && {
      executionMemoryContext: dispatchExecutionMemoryContext,
    }),
    ...(task.prNumber !== undefined && { prNumber: task.prNumber }),
    // INT-1585: forward optional per-task timeout override on retry, too,
    // so a transient first-dispatch failure does not silently revert to 5h.
    ...(task.timeoutHours !== undefined && { timeoutHours: task.timeoutHours }),
  });

  if (!dispatchResult.ok) {
    const dispatchError = dispatchResult.error;
    const dispatchProblem = dispatchProblemFromError(dispatchError);

    // Note: at_capacity is NOT retryable at entry *creation* (the regular task queue handles queuing),
    // but IS retryable during *drain* — if a retry entry already exists and the worker is at capacity,
    // we should increment and try again rather than permanently failing the task.
    if (dispatchError.blocker !== undefined) {
      await recordDispatchBlockedForRetry(deps, task, dispatchError.blocker);
    }

    if (!dispatchProblem.terminal) {
      const recordResult = await recordRetryTaskDispatchProblem(deps, task, dispatchProblem);
      if (!recordResult.ok) {
        return err(recordResult.error);
      }
      const updateResult = await updateRetryEntryOrError(deps, entry, {
        attempts: entry.attempts + 1,
        lastAttemptAt: new Date(),
        lastError: dispatchError.message,
      });
      if (!updateResult.ok) {
        return err(updateResult.error);
      }
      logger.info({ retryId: entry.id, attempts: entry.attempts + 1 }, 'Retry dispatch failed, will retry again');
      return ok({ action: 'retry_failed', taskId: entry.taskId });
    }

    // Non-retryable — fail permanently
    const failResult = await failRetryTaskForDispatchProblem(deps, task, dispatchProblem);
    if (!failResult.ok) {
      return err(failResult.error);
    }
    const deleteResult = await deleteRetryEntryOrError(
      deps,
      entry,
      'Failed to delete retry entry after terminal dispatch failure',
      'Failed to delete retry entry after terminal dispatch failure',
    );
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }
    const locksToCleanup = buildLockCleanups(task);
    return ok({ action: 'failed', taskId: entry.taskId, locksToCleanup });
  }

  // Success! The task claim already marked it dispatched before the network
  // call; persist dispatch metadata before deleting the retry entry.
  await resolveDispatchBlockersForRetry(deps, task);

  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(entry.taskId, {
    // Seed lastHeartbeat at dispatch so findZombieTasks (which uses a Firestore
    // inequality filter on lastHeartbeat) can sweep tasks that crash/fail
    // before the worker ever sends its first real heartbeat. Without this,
    // the field would be missing and the inequality filter would exclude the doc forever.
    lastHeartbeat: new Date(),
    workerLocation: dispatchResult.value.workerLocation,
    cancelNonce,
    cancelNonceExpiresAt,
    dispatchStatus: null,
  });

  if (!updateResult.ok) {
    logger.error({ taskId: entry.taskId, error: updateResult.error }, 'Failed to persist successful retry dispatch metadata');
    return err({ code: 'internal_error', message: 'Failed to persist successful retry dispatch metadata' });
  }

  await archiveRetriedTaskAfterDispatch({
    logger,
    codeTaskRepo,
    retryTaskId: task.id,
    warningMessage: 'Failed to archive original task after retry drain dispatch',
    ...(task.retriedFrom !== undefined && { retriedFrom: task.retriedFrom }),
  });
  await whatsappNotifier.notifyTaskStarted(task.userId, updateResult.value);

  const deleteResult = await deleteRetryEntryOrError(
    deps,
    entry,
    'Failed to delete retry entry after successful dispatch',
    'Failed to delete retry entry after successful dispatch',
  );
  if (!deleteResult.ok) {
    return err(deleteResult.error);
  }

  logger.info({ taskId: entry.taskId, workerLocation: dispatchResult.value.workerLocation }, 'Retry dispatch successful');
  return ok({ action: 'dispatched', taskId: entry.taskId });
}

async function handleTaskMessageRetry(
  deps: DrainRetryQueueDeps,
  entry: DispatchRetry,
): Promise<Result<DrainRetryQueueResult, DrainRetryQueueError>> {
  const { logger, workerSettingsRepo, taskDispatcher, logLineRepo } = deps;

  if (entry.userId === undefined || entry.taskId === undefined || entry.message === undefined) {
    logger.error({ retryId: entry.id }, 'task_message retry missing required fields');
    const deleteResult = await deleteRetryEntryOrError(
      deps,
      entry,
      'Failed to delete malformed task-message retry entry',
      'Failed to delete malformed task-message retry entry',
    );
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }
    return ok({ action: 'failed' });
  }

  // Fetch worker credentials
  const settingsResult = await workerSettingsRepo.getSettings(entry.userId);
  if (!settingsResult.ok || settingsResult.value === null) {
    const updateResult = await updateRetryEntryOrError(deps, entry, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: 'Failed to fetch worker settings',
    });
    if (!updateResult.ok) {
      return err(updateResult.error);
    }
    return ok({ action: 'retry_failed', taskId: entry.taskId });
  }

  const settings = settingsResult.value;
  const enabledWorkers = settings.workers.filter((w) => w.enabled);
  const worker = enabledWorkers[0];

  if (worker === undefined) {
    const updateResult = await updateRetryEntryOrError(deps, entry, {
      attempts: entry.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: 'No enabled workers',
    });
    if (!updateResult.ok) {
      return err(updateResult.error);
    }
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
      const updateResult = await updateRetryEntryOrError(deps, entry, {
        attempts: entry.attempts + 1,
        lastAttemptAt: new Date(),
        lastError: sendResult.error.message,
      });
      if (!updateResult.ok) {
        return err(updateResult.error);
      }
      logger.info({ retryId: entry.id, attempts: entry.attempts + 1 }, 'Retry message send failed, will retry again');
      return ok({ action: 'retry_failed', taskId: entry.taskId });
    }

    // Check if this is a stale task (worker says task doesn't exist anymore)
    const staleCheck: { success: false; dispatched: false; errorCode?: SendTaskMessageErrorCode; error?: string } = {
      success: false,
      dispatched: false,
      errorCode: sendResult.error.code as SendTaskMessageErrorCode,
      error: sendResult.error.message,
    };

    if (isStaleTaskError(staleCheck) && deps.createTaskForPRFn !== undefined) {
      logger.info(
        { retryId: entry.id, staleTaskId: entry.taskId, prNumber: entry.pullRequestNumber },
        'Message retry detected stale task, falling back to new task creation'
      );

      const deleteResult = await deleteRetryEntryOrError(
        deps,
        entry,
        'Failed to delete retry entry before stale task fallback',
        'Failed to delete retry entry before stale task fallback',
      );
      if (!deleteResult.ok) {
        return err(deleteResult.error);
      }

      const createResult = await deps.createTaskForPRFn({
        repository: entry.repository,
        prNumber: entry.pullRequestNumber,
        senderLogin: entry.senderLogin,
        comment: entry.message ?? '',
        eventId: entry.eventId,
        ...(entry.prTitle !== undefined && { prTitle: entry.prTitle }),
        ...(entry.baseBranch !== undefined && { baseBranch: entry.baseBranch }),
      });

      if (createResult.ok) {
        logger.info(
          { newTaskId: createResult.value.taskId, staleTaskId: entry.taskId },
          'Created fallback task after stale task message retry'
        );
        return ok({ action: 'stale_task_fallback', taskId: createResult.value.taskId });
      }

      logger.error(
        { error: createResult.error, staleTaskId: entry.taskId },
        'Failed to create fallback task after stale task message retry'
      );
      return ok({ action: 'failed', taskId: entry.taskId });
    }

    // Non-retryable and not stale — drop permanently
    const deleteResult = await deleteRetryEntryOrError(
      deps,
      entry,
      'Failed to delete retry entry after permanent message failure',
      'Failed to delete retry entry after permanent message failure',
    );
    if (!deleteResult.ok) {
      return err(deleteResult.error);
    }
    logger.warn({ retryId: entry.id, error: sendResult.error }, 'Message retry failed permanently');
    return ok({ action: 'failed', taskId: entry.taskId });
  }

  // Success
  const deleteResult = await deleteRetryEntryOrError(
    deps,
    entry,
    'Failed to delete retry entry after successful message delivery',
    'Failed to delete retry entry after successful message delivery',
  );
  if (!deleteResult.ok) {
    return err(deleteResult.error);
  }

  // Write [resumed] log line
  const sequence = Date.now() * 1000;
  await logLineRepo.storeBatch(entry.taskId, [
    { sequence, text: `[resumed] Message delivered via retry queue: ${entry.message}`, timestamp: Timestamp.now() },
  ]);

  logger.info({ taskId: entry.taskId }, 'Retry message delivery successful');
  return ok({ action: 'message_sent', taskId: entry.taskId });
}
