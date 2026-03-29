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
import {
  prepareExecutionMemoryContext,
  toDispatchExecutionMemoryContext,
  type PrepareExecutionMemoryResources,
} from './prepareExecutionMemoryContext.js';

/** Max candidates fetched per drain cycle for the per-resource concurrency guard. */
const DRAIN_CANDIDATE_BATCH_SIZE = 10;

function groupTasksByPR(tasks: CodeTask[]): Map<string, CodeTask[]> {
  const groups = new Map<string, CodeTask[]>();
  for (const task of tasks) {
    const key = `${task.repository}:${String(task.prNumber)}`;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return groups;
}

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
  orchestratorSecret: string;
  executionMemory?: PrepareExecutionMemoryResources;
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

    // Step 1b: Merge duplicate queued review tasks per PR (INT-1014)
    // At most 1 queued review per PR is allowed — cancel all but the newest (by createdAt)
    const reviewCandidates = candidates.filter(
      (c) => c.agentType === 'review' && c.prNumber !== undefined
    );

    const reviewGroups = groupTasksByPR(reviewCandidates);

    // Remove cancelled reviews from candidates so they are not considered for dispatch
    const cancelledReviewIds = new Set<string>();

    for (const [, group] of reviewGroups) {
      if (group.length <= 1) continue;

      // Sort by createdAt descending (newest first), cancel older ones
      group.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
      const newest = group[0];
      /* v8 ignore start -- ts-type: Array groupBy always returns dense arrays — cannot produce sparse result @preserve */
      if (newest === undefined) continue;
      /* v8 ignore stop @preserve */
      const toCancel = group.slice(1);

      for (const cancelled of toCancel) {
        logger.info(
          {
            cancelledTaskId: cancelled.id,
            survivingTaskId: newest.id,
            repository: cancelled.repository,
            prNumber: cancelled.prNumber,
          },
          'Cancelling duplicate queued review — superseded by newer queued review for same PR'
        );

        const updateResult = await codeTaskRepo.update(cancelled.id, {
          status: 'cancelled',
          completedAt: new Date(),
          error: {
            code: 'review_replaced',
            message: 'Superseded by newer queued review for same PR',
          },
        });

        if (!updateResult.ok) {
          logger.warn(
            { cancelledTaskId: cancelled.id, error: updateResult.error },
            'Failed to cancel duplicate queued review — will remain eligible for future dispatch'
          );
          continue;
        }
        cancelledReviewIds.add(cancelled.id);
      }
    }

    const activeCandidates = candidates.filter((c) => !cancelledReviewIds.has(c.id));

    // Round-robin: group PR-bound candidates by PR, pick first from each group,
    // then merge with non-PR tasks sorted by age so older work is never starved.
    const prBoundCandidates = activeCandidates.filter((c) => c.prNumber !== undefined);
    const noPrCandidates = activeCandidates.filter((c) => c.prNumber === undefined);
    const prGroups = groupTasksByPR(prBoundCandidates);

    // Collect the first (oldest) task from each PR group
    const prRepresentatives: CodeTask[] = [];
    for (const group of prGroups.values()) {
      const first = group[0];
      /* v8 ignore start -- ts-type: noUncheckedIndexedAccess guard — Map groups are always non-empty by construction @preserve */
      if (first === undefined) continue;
      /* v8 ignore stop @preserve */
      prRepresentatives.push(first);
    }

    // Merge PR representatives with non-PR tasks, sorted by createdAt (oldest first)
    // so that older non-PR tasks (planning/execution) are not starved by newer PR work.
    const roundRobinCandidates = [...prRepresentatives, ...noPrCandidates].sort(
      (a, b) => a.createdAt.toMillis() - b.createdAt.toMillis()
    );

    // Find first dispatchable candidate with TTL-first + per-PR guard
    let task: CodeTask | null = null;
    for (const candidate of roundRobinCandidates) {
      // TTL check FIRST — expire deadlocked tasks before they block forever
      const queuedAt = candidate.queuedAt?.toDate() ?? candidate.createdAt.toDate();
      const ttlMs = config.queue.ttlMinutes * 60 * 1000;
      const now = Date.now();

      if (now - queuedAt.getTime() > ttlMs) {
        logger.warn({ taskId: candidate.id, queuedAt }, 'Queued task expired');
        await codeTaskRepo.update(candidate.id, {
          status: 'failed',
          error: {
            code: 'queue_timeout',
            message: `Task expired in queue after ${String(config.queue.ttlMinutes)} minutes. Workers were still busy.`,
          },
        });

        const locksToCleanup = buildLockCleanups(candidate);

        // Clear parent planning task's implementationTaskId if this was an execution agent task
        if (candidate.parentTaskId !== undefined) {
          const parentResult = await codeTaskRepo.findById(candidate.parentTaskId);
          if (parentResult.ok && parentResult.value.implementationTaskId === candidate.id) {
            const clearResult = await codeTaskRepo.update(candidate.parentTaskId, { implementationTaskId: null });
            if (!clearResult.ok) {
              logger.warn({ parentTaskId: candidate.parentTaskId, expiredTaskId: candidate.id, error: clearResult.error }, 'Failed to clear implementationTaskId on parent task after queue expiry');
            }
          }
        }

        const notifyResult = await whatsappNotifier.notifyTaskQueueExpired(candidate.userId, candidate);
        if (!notifyResult.ok) {
          logger.warn({ taskId: candidate.id, error: notifyResult.error }, 'Failed to send queue expired notification');
        }

        return ok({ action: 'expired', taskId: candidate.id, locksToCleanup });
      }

      // Per-PR concurrency guard: only dispatched/running tasks block (NOT queued)
      if (candidate.prNumber !== undefined) {
        const prActiveResult = await codeTaskRepo.hasDispatchedOrRunningForPR(candidate.repository, candidate.prNumber);
        if (prActiveResult.ok && prActiveResult.value.hasActive) {
          logger.info({
            taskId: candidate.id,
            repository: candidate.repository,
            prNumber: candidate.prNumber,
            activeTaskId: prActiveResult.value.taskId,
          }, 'Skipping queued task — dispatched/running task exists for same PR');
          continue;
        }
      }

      task = candidate;
      break;
    }

    if (task === null) {
      logger.info({ candidateCount: roundRobinCandidates.length }, 'All queued tasks blocked by active resources');
      return ok({ action: 'still_busy' });
    }

    logger.info({ taskId: task.id }, 'Processing queued task');

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
          orchestratorSecret: deps.orchestratorSecret,
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
    let taskExecutionMemoryContext = task.executionMemoryContext;

    if (
      config.executionMemoryEnabled
      && agentType === 'execution'
      && taskExecutionMemoryContext === undefined
    ) {
      taskExecutionMemoryContext = await prepareExecutionMemoryContext({
        task,
        linearIssueLabels: dispatchLabels,
        logger,
        linearAgentClient,
        queryClient: deps.executionMemory?.queryClient,
        embeddingClient: deps.executionMemory?.embeddingClient,
        executionMemoryRepo: deps.executionMemory?.executionMemoryRepo,
        executionMemoryApplicationRepo: deps.executionMemory?.executionMemoryApplicationRepo,
      });

      const memoryUpdateResult = await codeTaskRepo.update(task.id, {
        executionMemoryContext: taskExecutionMemoryContext,
      });

      if (!memoryUpdateResult.ok) {
        logger.warn(
          { taskId: task.id, error: memoryUpdateResult.error },
          'Failed to persist execution memory context before dispatch'
        );
      }
    }

    const dispatchExecutionMemoryContext = toDispatchExecutionMemoryContext(taskExecutionMemoryContext);

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
      ...(task.trackingCommentId !== undefined && { trackingCommentId: task.trackingCommentId }),
      ...(task.retriedFrom !== undefined && { retriedFrom: task.retriedFrom }),
      ...(task.reviewTypes !== undefined && { reviewTypes: task.reviewTypes }),
      ...(dispatchExecutionMemoryContext !== undefined && {
        executionMemoryContext: dispatchExecutionMemoryContext,
      }),
      ...(task.prNumber !== undefined && { prNumber: task.prNumber }),
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
