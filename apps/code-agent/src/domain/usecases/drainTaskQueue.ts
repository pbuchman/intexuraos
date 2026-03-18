/**
 * Use case: Drain task queue by dispatching oldest queued task.
 *
 * Called by Cloud Scheduler via POST /internal/drain-queue.
 * Uses dedicated dispatch-only path (not processCodeAction) to avoid dedup rejection.
 *
 * INT-619: Task queueing when workers are at capacity.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import { loadConfig } from '../../config.js';
import { generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
import { buildLockCleanups, type LockCleanupInfo } from '../utils/prTaskLock.js';
import { ensureDispatchLabelsForAgentType, resolveTaskAgentType } from '../utils/taskRouting.js';
import { archiveRetriedTaskAfterDispatch } from '../utils/archiveRetriedTaskAfterDispatch.js';
import { shouldFanOut, fanOutChildTasks } from './fanOutChildTasks.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';

/** Max candidates fetched per drain cycle for the per-resource concurrency guard. */
const DRAIN_CANDIDATE_BATCH_SIZE = 10;

// In-memory guard for single-instance environments
let isDraining = false;

// Exported for testing
export function _resetDrainGuard(): void {
  isDraining = false;
}

export interface DrainTaskQueueResult {
  action: 'dispatched' | 'expired' | 'still_busy' | 'empty' | 'skipped' | 'failed';
  taskId?: string;
  locksToCleanup?: LockCleanupInfo[];
}

export interface DrainTaskQueueError {
  code: 'internal_error' | 'concurrent_drain';
  message: string;
}

export interface DrainTaskQueueDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskDispatcher: TaskDispatcherService;
  linearAgentClient: LinearAgentClient;
  whatsappNotifier: WhatsAppNotifier;
  workerSettingsRepo: WorkerSettingsRepository;
  taskEnqueueService: TaskEnqueueService;
}

export async function drainTaskQueue(
  deps: DrainTaskQueueDeps
): Promise<Result<DrainTaskQueueResult, DrainTaskQueueError>> {
  const { logger, codeTaskRepo, taskDispatcher, linearAgentClient, whatsappNotifier, workerSettingsRepo } = deps;
  const config = loadConfig();

  // Fast-path guard for single-instance
  if (isDraining) {
    logger.info({ reason: 'concurrent' }, 'Drain already in progress, skipping');
    return ok({ action: 'skipped' });
  }

  isDraining = true;
  try {
    // Step 1: Fetch queued candidates (INT-949: per-resource concurrency guard)
    const candidatesResult = await codeTaskRepo.listQueuedByAge(DRAIN_CANDIDATE_BATCH_SIZE);
    if (!candidatesResult.ok) {
      logger.error({ error: candidatesResult.error }, 'Failed to list queued tasks');
      return err({ code: 'internal_error', message: candidatesResult.error.message });
    }

    const candidates = candidatesResult.value;
    if (candidates.length === 0) {
      logger.info({ queue: 'empty' }, 'No queued tasks to drain');
      return ok({ action: 'empty' });
    }

    // Find first dispatchable candidate (no active task for same resource)
    let task: CodeTask | null = null;
    for (const candidate of candidates) {
      // Check Linear issue concurrency
      if (candidate.linearIssueId !== undefined) {
        const activeResult = await codeTaskRepo.hasActiveTaskForLinearIssue(candidate.linearIssueId);
        if (activeResult.ok && activeResult.value.hasActive && activeResult.value.taskId !== candidate.id) {
          logger.info({
            taskId: candidate.id,
            linearIssueId: candidate.linearIssueId,
            activeTaskId: activeResult.value.taskId,
          }, 'Skipping queued task — active task exists for same Linear issue');
          continue;
        }
      }

      // Check PR concurrency (for PR-scoped tasks like review/pull_request agents)
      if (candidate.prNumber !== undefined) {
        const prActiveResult = await codeTaskRepo.findActiveReviewForPR(candidate.repository, candidate.prNumber);
        if (prActiveResult.ok && prActiveResult.value !== null && prActiveResult.value.id !== candidate.id) {
          logger.info({
            taskId: candidate.id,
            repository: candidate.repository,
            prNumber: candidate.prNumber,
            activeTaskId: prActiveResult.value.id,
          }, 'Skipping queued task — active task exists for same PR');
          continue;
        }
      }

      task = candidate;
      break;
    }

    if (task === null) {
      logger.info({ candidateCount: candidates.length }, 'All queued tasks blocked by active resources');
      return ok({ action: 'still_busy' });
    }

    logger.info({ taskId: task.id }, 'Processing queued task');

    // Step 2: Check TTL
    const queuedAt = task.queuedAt?.toDate() ?? task.createdAt.toDate();
    const ttlMs = config.queue.ttlMinutes * 60 * 1000;
    const now = Date.now();

    if (now - queuedAt.getTime() > ttlMs) {
      logger.warn({ taskId: task.id, queuedAt }, 'Queued task expired');
      await codeTaskRepo.update(task.id, {
        status: 'failed',
        error: {
          code: 'queue_timeout',
          message: `Task expired in queue after ${String(config.queue.ttlMinutes)} minutes. Workers were still busy.`,
        },
      });

      const locksToCleanup = buildLockCleanups(task);

      // Clear parent planning task's implementationTaskId if this was an execution agent task,
      // so the web UI can re-submit (INT-619 review fix #2)
      if (task.parentTaskId !== undefined) {
        const parentResult = await codeTaskRepo.findById(task.parentTaskId);
        if (parentResult.ok && parentResult.value.implementationTaskId === task.id) {
          const clearResult = await codeTaskRepo.update(task.parentTaskId, { implementationTaskId: null });
          if (!clearResult.ok) {
            logger.warn({ parentTaskId: task.parentTaskId, expiredTaskId: task.id, error: clearResult.error }, 'Failed to clear implementationTaskId on parent task after queue expiry');
          }
        }
      }

      const notifyResult = await whatsappNotifier.notifyTaskQueueExpired(task.userId, task);
      if (!notifyResult.ok) {
        logger.warn({ taskId: task.id, error: notifyResult.error }, 'Failed to send queue expired notification');
      }

      return ok({ action: 'expired', taskId: task.id, locksToCleanup });
    }

    // Step 3: Fetch user's CURRENT worker settings
    const settingsResult = await workerSettingsRepo.getSettings(task.userId);
    if (!settingsResult.ok || settingsResult.value === null) {
      logger.error({ userId: task.userId }, 'Failed to fetch worker settings for drain');
      return err({ code: 'internal_error', message: 'Failed to fetch worker settings' });
    }

    const settings = settingsResult.value;
    const enabledWorkers = settings.workers.filter((w) => w.enabled);

    if (enabledWorkers.length === 0) {
      logger.warn(
        { userId: task.userId, taskId: task.id, reason: 'no_enabled_workers' },
        'Drain blocked: user has no enabled workers — task stays queued until workers are configured or TTL expires',
      );
      return ok({ action: 'still_busy', taskId: task.id });
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

    // Step 4: Fetch FRESH Linear issue metadata
    let linearIssueLabels: string[] = [];
    let hasChildren = false;
    let linearIssueUuid: string | undefined;

    if (task.linearIssueId !== undefined) {
      const validateResult = await linearAgentClient.validateIssue({
        userId: task.userId,
        identifier: task.linearIssueId,
      });

      if (validateResult.ok) {
        linearIssueLabels = validateResult.value.labels;
        hasChildren = validateResult.value.childCount > 0;
        linearIssueUuid = validateResult.value.id;
      } else {
        logger.warn({ linearIssueId: task.linearIssueId }, 'Failed to refresh Linear labels during drain');
      }
    }
    // Step 4b: Fan-out check (INT-962) — if parent issue has children with code-task labels,
    // create separate child tasks instead of dispatching the parent.
    if (shouldFanOut(hasChildren, linearIssueLabels) && task.linearIssueId !== undefined) {
      logger.info({ taskId: task.id, linearIssueId: task.linearIssueId }, 'Drain fan-out triggered: parent issue has code-task children');

      const fanOutResult = await fanOutChildTasks(
        {
          logger,
          codeTaskRepo,
          linearAgentClient,
          taskEnqueueService: deps.taskEnqueueService,
        },
        {
          parentTask: task,
          userId: task.userId,
          linearIssueId: task.linearIssueId,
          ...(linearIssueUuid !== undefined && { parentIssueUuid: linearIssueUuid }),
        },
      );

      if (fanOutResult.ok) {
        logger.info(
          { taskId: task.id, childTaskIds: fanOutResult.value.childTaskIds },
          'Drain fan-out completed, parent task marked as implemented',
        );
        return ok({ action: 'dispatched', taskId: task.id });
      }

      // Fan-out failed — fall through to normal dispatch
      logger.warn(
        { taskId: task.id, error: fanOutResult.error },
        'Drain fan-out failed, falling back to normal dispatch',
      );
    }

    const agentType = resolveTaskAgentType(task, linearIssueLabels);
    const dispatchLabels = ensureDispatchLabelsForAgentType(linearIssueLabels, agentType);

    // Step 5: Attempt dispatch
    const webhookUrl = `${config.serviceUrl}/internal/webhooks/task-complete`;

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
      // INT-949: Dispatch metadata fields from task document
      ...(task.planningPrBranch !== undefined && { planningPrBranch: task.planningPrBranch }),
      ...(task.planningPrUrl !== undefined && { planningPrUrl: task.planningPrUrl }),
      ...(task.trackingCommentId !== undefined && { trackingCommentId: task.trackingCommentId }),
      ...(task.retriedFrom !== undefined && { retriedFrom: task.retriedFrom }),
    });

    if (!dispatchResult.ok) {
      const dispatchError = dispatchResult.error;

      // Only at_capacity means workers are genuinely busy — task stays queued
      if (dispatchError.code === 'at_capacity') {
        logger.info({ taskId: task.id, error: dispatchError }, 'Workers still busy, task remains queued');
        return ok({ action: 'still_busy', taskId: task.id });
      }

      // Other dispatch failures (network_error, dispatch_failed, etc.) — fail the task
      logger.error({ taskId: task.id, error: dispatchError }, 'Drain dispatch failed with non-capacity error');
      const failUpdateResult = await codeTaskRepo.update(task.id, {
        status: 'failed',
        error: {
          code: dispatchError.code,
          message: `Drain dispatch failed: ${dispatchError.message}`,
        },
      });
      if (!failUpdateResult.ok) {
        logger.error({ taskId: task.id, error: failUpdateResult.error }, 'Failed to persist failed status during drain');
      }

      const locksToCleanup = buildLockCleanups(task);

      return ok({ action: 'failed', taskId: task.id, locksToCleanup });
    }

    // Step 6: Success - update status to dispatched
    const cancelNonce = generateCancelNonce();
    const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

    const updateResult = await codeTaskRepo.update(task.id, {
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
        warningMessage: 'Failed to archive original task after queued retry dispatch',
        ...(task.retriedFrom !== undefined && { retriedFrom: task.retriedFrom }),
      });
      await whatsappNotifier.notifyTaskStarted(task.userId, updateResult.value);
    }

    logger.info({ taskId: task.id, workerLocation: dispatchResult.value.workerLocation }, 'Queued task dispatched');
    return ok({ action: 'dispatched', taskId: task.id });

  } finally {
    isDraining = false;
  }
}
