/**
 * Use case: Drain task queue by dispatching oldest queued task.
 *
 * Called by Cloud Scheduler via POST /internal/drain-queue.
 * Uses dedicated dispatch-only path to avoid create-time dedup rejection.
 *
 * INT-619: Task queueing when workers are at capacity.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type { CodeTask, CodeTaskDispatchStatus } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LogLineRepository } from '../repositories/logLineRepository.js';
import type { CodeTaskDispatchNotificationRepository } from '../repositories/codeTaskDispatchNotificationRepository.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../services/taskDispatcher.js';
import type { LinearAgentClient } from '../ports/linearAgentClient.js';
import type { AutomationLog } from '../ports/automationLog.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import type { WorkerSettingsRepository } from '../ports/workerSettingsRepository.js';
import type { CodeTaskDispatchStatusService } from '../services/codeTaskDispatchStatusService.js';
import {
  classifyCodeTaskDispatchability,
} from '../services/codeTaskDispatchBlockers.js';
import {
  buildDispatchStatusForProblem,
  dispatchProblemFromBlocker,
  dispatchProblemFromError,
  missingPrBranchDispatchProblem,
  notifyDispatchProblemForTask,
  queueTimeoutDispatchProblemFromTask,
  taskErrorFromDispatchStatus,
  type DispatchBlocker,
  type DispatchProblem,
} from '../services/codeTaskDispatchProblems.js';
import { reportDispatchFailure } from '../services/codeTaskDispatchFailureReporter.js';
import { loadConfig } from '../../config.js';
import { generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
import { buildLockCleanups, type LockCleanupInfo } from '../utils/prTaskLock.js';
import { ensureDispatchLabelsForAgentType, resolveTaskAgentType } from '../utils/taskRouting.js';
import { archiveRetriedTaskAfterDispatch } from '../utils/archiveRetriedTaskAfterDispatch.js';
import { isMemoryEligibleAgent } from '../utils/memoryEligibility.js';
import { shouldFanOut, fanOutChildTasks } from './fanOutChildTasks.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import {
  buildTaskCompleteWebhookUrl,
  classifyCallbackOwner,
  normalizeCallbackBaseUrl,
} from '../services/codeTaskCallbackUrls.js';
import {
  prepareExecutionMemoryContext,
  toDispatchExecutionMemoryContext,
  type PrepareExecutionMemoryResources,
} from './prepareExecutionMemoryContext.js';

/**
 * Max candidates fetched per drain cycle for the per-resource concurrency guard.
 * Kept as a fallback for callers that need a safe default; the drain cycle itself
 * uses `config.queue.maxSize` so older future-scheduled rows cannot starve newer
 * eligible work (INT-1463).
 */
export const DRAIN_CANDIDATE_BATCH_SIZE = 10;

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

function findAffectedDispatchTasks(candidates: readonly CodeTask[], task: CodeTask): CodeTask[] {
  return candidates.filter(
    (candidate) => candidate.userId === task.userId && candidate.workerType === task.workerType
  );
}

function buildWaitingDispatchStatus(
  task: CodeTask,
  input: {
    reason: 'scheduled_wait' | 'active_task_blocked';
    message: string;
    remediation: string;
    nextAction: Extract<CodeTaskDispatchStatus['nextAction'], 'wait_until_scheduled' | 'wait_for_active_task'>;
  }
): CodeTaskDispatchStatus {
  const now = Timestamp.fromDate(new Date());
  return {
    state: 'waiting',
    reason: input.reason,
    terminal: false,
    severity: 'info',
    message: input.message,
    remediation: input.remediation,
    workerNames: [],
    firstSeenAt: task.dispatchStatus?.reason === input.reason ? task.dispatchStatus.firstSeenAt : now,
    lastSeenAt: now,
    nextAction: input.nextAction,
    ...(task.dispatchStatus?.notifiedReasons !== undefined && {
      notifiedReasons: task.dispatchStatus.notifiedReasons,
    }),
  };
}

async function recordScheduledWaitStatus(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskRepo'>,
  task: CodeTask,
  notBeforeAt: Date
): Promise<void> {
  const updateResult = await deps.codeTaskRepo.update(task.id, {
    dispatchStatus: buildWaitingDispatchStatus(task, {
      reason: 'scheduled_wait',
      message: `Task is scheduled for dispatch at ${notBeforeAt.toISOString()}.`,
      remediation: 'The scheduler will dispatch this task automatically once the scheduled time arrives.',
      nextAction: 'wait_until_scheduled',
    }),
  });
  if (!updateResult.ok) {
    deps.logger.warn(
      { taskId: task.id, notBeforeAt: notBeforeAt.toISOString(), error: updateResult.error },
      'Failed to persist scheduled dispatch wait status'
    );
  }
}

async function recordActiveTaskWaitStatus(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskRepo'>,
  task: CodeTask,
  input:
    | { activeTaskId?: string | undefined; queuedAt?: Date; scope: 'pr' }
    | { activeTaskId?: string | undefined; queuedAt?: Date; scope: 'linear_issue'; linearIssueId: string }
): Promise<void> {
  const message = input.scope === 'pr'
    ? `Another task is already dispatched or running for PR #${String(task.prNumber)}.`
    : `Another task is already dispatched or running for Linear issue ${input.linearIssueId}.`;
  const updateResult = await deps.codeTaskRepo.update(task.id, {
    ...(input.queuedAt !== undefined && { queuedAt: input.queuedAt }),
    dispatchStatus: buildWaitingDispatchStatus(task, {
      reason: 'active_task_blocked',
      message,
      remediation: 'The scheduler will retry this task automatically after the active task finishes.',
      nextAction: 'wait_for_active_task',
    }),
  });
  if (!updateResult.ok) {
    deps.logger.warn(
      { taskId: task.id, activeTaskId: input.activeTaskId, error: updateResult.error },
      input.scope === 'pr'
        ? 'Failed to reset queuedAt for PR-locked task — TTL clock continues from original queuedAt'
        : 'Failed to persist active-task dispatch wait status'
    );
  }
}

async function failTaskForDispatchProblem(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskRepo' | 'whatsappNotifier' | 'logLineRepo' | 'automationLog' | 'codeTaskDispatchNotificationRepo'>,
  task: CodeTask,
  problem: DispatchProblem,
  affectedTaskCount: number,
  phase: 'terminal' | 'timeout' = 'terminal',
): Promise<Result<void, DrainTaskQueueError>> {
  const dispatchStatus = buildDispatchStatusForProblem({
    task,
    problem,
  });
  const failUpdateResult = await deps.codeTaskRepo.update(task.id, {
    status: 'failed',
    error: taskErrorFromDispatchStatus(dispatchStatus),
    dispatchStatus,
  });
  if (!failUpdateResult.ok) {
    deps.logger.error(
      { taskId: task.id, reason: problem.reason, error: failUpdateResult.error },
      'Failed to persist failed status during dispatch blocker handling'
    );
    return err({
      code: 'internal_error',
      message: 'Failed to persist dispatch failure status',
    });
  }
  await reportOrNotifyDispatchProblem(deps, task, dispatchStatus, problem, affectedTaskCount, phase);
  return ok(undefined);
}

async function failAffectedTasksForDispatchProblem(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskRepo' | 'whatsappNotifier' | 'logLineRepo' | 'automationLog' | 'codeTaskDispatchNotificationRepo'>,
  tasks: readonly CodeTask[],
  problem: DispatchProblem,
  phase: 'terminal' | 'timeout' = 'terminal',
): Promise<Result<void, DrainTaskQueueError>> {
  const affectedTaskCount = tasks.length;
  for (const affectedTask of tasks) {
    const failResult = await failTaskForDispatchProblem(
      deps,
      affectedTask,
      problem,
      affectedTaskCount,
      phase,
    );
    if (!failResult.ok) {
      return failResult;
    }
  }
  return ok(undefined);
}

async function rollbackTaskForRecoverableDispatchProblem(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskRepo' | 'whatsappNotifier' | 'logLineRepo' | 'automationLog' | 'codeTaskDispatchNotificationRepo'>,
  task: CodeTask,
  problem: DispatchProblem,
  affectedTaskCount: number,
): Promise<Result<void, DrainTaskQueueError>> {
  const dispatchStatus = buildDispatchStatusForProblem({
    task,
    problem,
  });
  const rollbackResult = await deps.codeTaskRepo.update(task.id, {
    status: 'queued',
    dispatchStatus,
  });
  if (!rollbackResult.ok) {
    deps.logger.warn(
      { taskId: task.id, error: rollbackResult.error },
      'Failed to roll back claim after retryable dispatch error',
    );
    return err({
      code: 'internal_error',
      message: 'Failed to persist recoverable dispatch status',
    });
  }
  await reportOrNotifyDispatchProblem(deps, task, dispatchStatus, problem, affectedTaskCount, 'waiting');
  return ok(undefined);
}

async function rollbackAffectedTasksForRecoverableDispatchProblem(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskRepo' | 'whatsappNotifier' | 'logLineRepo' | 'automationLog' | 'codeTaskDispatchNotificationRepo'>,
  tasks: readonly CodeTask[],
  problem: DispatchProblem,
): Promise<Result<void, DrainTaskQueueError>> {
  const affectedTaskCount = tasks.length;
  for (const affectedTask of tasks) {
    const rollbackResult = await rollbackTaskForRecoverableDispatchProblem(
      deps,
      affectedTask,
      problem,
      affectedTaskCount,
    );
    if (!rollbackResult.ok) {
      return rollbackResult;
    }
  }
  return ok(undefined);
}

async function reportOrNotifyDispatchProblem(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskRepo' | 'whatsappNotifier' | 'logLineRepo' | 'automationLog' | 'codeTaskDispatchNotificationRepo'>,
  task: CodeTask,
  dispatchStatus: CodeTaskDispatchStatus,
  problem: DispatchProblem,
  affectedTaskCount: number,
  phase: 'waiting' | 'terminal' | 'timeout',
): Promise<void> {
  /* v8 ignore start -- ts-type: optional reporter dependencies are conditional for exactOptionalPropertyTypes; production queue routes always provide all three deps @preserve */
  if (
    deps.logLineRepo !== undefined
    && deps.automationLog !== undefined
    && deps.codeTaskDispatchNotificationRepo !== undefined
  ) {
    await reportDispatchFailure({
      task,
      dispatchStatus,
      problem,
      phase,
      affectedTaskCount,
      logLineRepo: deps.logLineRepo,
      automationLog: deps.automationLog,
      whatsappNotifier: deps.whatsappNotifier,
      notificationRepo: deps.codeTaskDispatchNotificationRepo,
      logger: deps.logger,
    });
    return;
  }
  /* v8 ignore stop @preserve */

  await notifyDispatchProblemForTask({
    task,
    dispatchStatus,
    problem,
    whatsappNotifier: deps.whatsappNotifier,
    codeTaskRepo: deps.codeTaskRepo,
    logger: deps.logger,
    affectedTaskCount,
  });
}

async function recordDispatchBlockedForTask(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskDispatchStatusService'>,
  candidates: readonly CodeTask[],
  task: CodeTask,
  blocker: DispatchBlocker
): Promise<void> {
  if (deps.codeTaskDispatchStatusService === undefined) {
    return;
  }

  const affectedTasks = findAffectedDispatchTasks(candidates, task);
  try {
    await deps.codeTaskDispatchStatusService.recordDispatchBlocked({
      userId: task.userId,
      workerType: task.workerType,
      blocker,
      affectedTaskCount: affectedTasks.length,
      exampleTaskIds: affectedTasks.slice(0, 5).map((affectedTask) => affectedTask.id),
    });
  } catch (error) {
    deps.logger.warn(
      { taskId: task.id, reason: blocker.reason, error },
      'Failed to record code task dispatch blocker status'
    );
  }
}

async function resolveDispatchBlockersForTask(
  deps: Pick<DrainTaskQueueDeps, 'logger' | 'codeTaskDispatchStatusService'>,
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
      'Failed to resolve code task dispatch blocker statuses'
    );
  }
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
  logLineRepo?: LogLineRepository;
  automationLog?: AutomationLog;
  codeTaskDispatchNotificationRepo?: CodeTaskDispatchNotificationRepository;
  workerSettingsRepo: WorkerSettingsRepository;
  codeTaskDispatchStatusService?: CodeTaskDispatchStatusService;
  taskEnqueueService: TaskEnqueueService;
  orchestratorSecret: string;
  executionMemory?: PrepareExecutionMemoryResources;
  userServiceClient?: Pick<UserServiceClient, 'getLlmClient'>;
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
    // INT-1463: scan the full queued set so future-scheduled rows do not hide newer
    // eligible work behind them. `config.queue.maxSize` bounds the queue itself.
    const drainBatchSize = config.queue.maxSize;
    const candidatesResult = await codeTaskRepo.listQueuedByAge(drainBatchSize);
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

    // Find first dispatchable candidate with per-PR guard + TTL check
    let task: CodeTask | null = null;
    let futureScheduledCount = 0;
    let activeResourceBlockedCount = 0;
    let nextEligibleAt: Date | undefined;
    for (const candidate of roundRobinCandidates) {
      // INT-1463: schedule-aware skip — if the task is not yet eligible for dispatch,
      // skip BEFORE the PR-lock check and BEFORE the TTL check. Do not touch queuedAt
      // (TTL must remain independent of the schedule wait — see notBeforeAt branch below).
      const notBeforeAt = candidate.dispatchSchedule?.notBeforeAt;
      if (notBeforeAt !== undefined && notBeforeAt.toMillis() > Date.now()) {
        futureScheduledCount += 1;
        const notBeforeDate = notBeforeAt.toDate();
        if (nextEligibleAt === undefined || notBeforeDate.getTime() < nextEligibleAt.getTime()) {
          nextEligibleAt = notBeforeDate;
        }
        await recordScheduledWaitStatus({ logger, codeTaskRepo }, candidate, notBeforeDate);
        logger.info(
          {
            taskId: candidate.id,
            notBeforeAt: notBeforeDate.toISOString(),
            source: candidate.dispatchSchedule?.source,
          },
          'Skipping future-scheduled task — not yet eligible',
        );
        continue;
      }

      // Per-PR concurrency guard FIRST — don't expire tasks that are merely PR-locked
      if (candidate.prNumber !== undefined) {
        const prActiveResult = await codeTaskRepo.hasDispatchedOrRunningForPR(candidate.repository, candidate.prNumber);
        if (prActiveResult.ok && prActiveResult.value.hasActive) {
          activeResourceBlockedCount += 1;
          logger.info({
            taskId: candidate.id,
            repository: candidate.repository,
            prNumber: candidate.prNumber,
            activeTaskId: prActiveResult.value.taskId,
          }, 'Skipping queued task — dispatched/running task exists for same PR');

          // Reset TTL so PR-lock-blocked time does not count toward expiry.
          await recordActiveTaskWaitStatus(
            { logger, codeTaskRepo },
            candidate,
            { queuedAt: new Date(), scope: 'pr', activeTaskId: prActiveResult.value.taskId }
          );

          continue;
        }
      }

      // Defer reviews while a non-self sibling on the same Linear issue is
      // dispatched/running. Excludes queued from the filter so two queued
      // reviews on the same issue cannot both defer and deadlock.
      if (candidate.agentType === 'review' && candidate.linearIssueId !== undefined) {
        const siblingResult = await codeTaskRepo.hasOtherDispatchedOrRunningForLinearIssue(
          candidate.id,
          candidate.linearIssueId,
        );
        if (siblingResult.ok && siblingResult.value.hasActive) {
          activeResourceBlockedCount += 1;
          logger.info(
            {
              taskId: candidate.id,
              linearIssueId: candidate.linearIssueId,
              activeTaskId: siblingResult.value.taskId,
            },
            'Deferring review — another task on the same Linear issue is dispatched/running',
          );
          await recordActiveTaskWaitStatus(
            { logger, codeTaskRepo },
            candidate,
            { scope: 'linear_issue', linearIssueId: candidate.linearIssueId, activeTaskId: siblingResult.value.taskId }
          );
          continue;
        }
      }

      // TTL check — only for tasks that are actually dispatchable (not PR-locked)
      // INT-1463: scheduled tasks may legitimately sit in the queue past TTL while waiting
      // for their notBeforeAt. Compute effective eligibility as max(queuedAt, notBeforeAt)
      // so TTL only starts counting from the moment the task is actually eligible.
      const queuedAt = candidate.queuedAt?.toDate() ?? candidate.createdAt.toDate();
      const notBeforeDate = candidate.dispatchSchedule?.notBeforeAt.toDate();
      const effectiveEligibleAt = notBeforeDate !== undefined && notBeforeDate.getTime() > queuedAt.getTime()
        ? notBeforeDate
        : queuedAt;
      const ttlMs = config.queue.ttlMinutes * 60 * 1000;
      const now = Date.now();

      if (now - effectiveEligibleAt.getTime() > ttlMs) {
        logger.warn({ taskId: candidate.id, queuedAt }, 'Queued task expired');
        const timeoutProblem = queueTimeoutDispatchProblemFromTask(candidate, config.queue.ttlMinutes);
        const dispatchStatus = buildDispatchStatusForProblem({
          task: candidate,
          problem: timeoutProblem,
        });
        const timeoutUpdateResult = await codeTaskRepo.update(candidate.id, {
          status: 'failed',
          error: {
            code: 'queue_timeout',
            message: timeoutProblem.message,
          },
          dispatchStatus,
        });
        if (!timeoutUpdateResult.ok) {
          logger.error(
            { taskId: candidate.id, error: timeoutUpdateResult.error },
            'Failed to mark task failed after queue timeout'
          );
          return err({ code: 'internal_error', message: 'Failed to persist queue timeout status' });
        }

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

        await reportOrNotifyDispatchProblem(
          deps,
          candidate,
          dispatchStatus,
          timeoutProblem,
          1,
          'timeout'
        );

        return ok({ action: 'expired', taskId: candidate.id, locksToCleanup });
      }

      task = candidate;
      break;
    }

    if (task === null) {
      if (futureScheduledCount === roundRobinCandidates.length && futureScheduledCount > 0) {
        logger.info(
          {
            candidateCount: roundRobinCandidates.length,
            futureScheduledCount,
            ...(nextEligibleAt !== undefined && { nextEligibleAt: nextEligibleAt.toISOString() }),
          },
          'All queued tasks are future-scheduled and not yet eligible'
        );
      } else {
        logger.info(
          {
            candidateCount: roundRobinCandidates.length,
            futureScheduledCount,
            activeResourceBlockedCount,
          },
          'All queued tasks blocked by active resources'
        );
      }
      return ok({ action: 'still_busy' });
    }

    logger.info({ taskId: task.id }, 'Processing queued task');

    // Step 3: Fetch user's CURRENT worker settings
    const settingsResult = await workerSettingsRepo.getSettings(task.userId);
    if (!settingsResult.ok) {
      logger.error({ userId: task.userId }, 'Failed to fetch worker settings for drain');
      return err({ code: 'internal_error', message: 'Failed to fetch worker settings' });
    }

    const enabledWorkers = settingsResult.value?.workers.filter((w) => w.enabled) ?? [];

    if (enabledWorkers.length === 0) {
      const dispatchability = classifyCodeTaskDispatchability({
        workerType: task.workerType,
        workers: enabledWorkers,
        healthByWorkerName: {},
      }) as DispatchBlocker;
      const claimResult = await codeTaskRepo.claimForDispatch(task.id);
      if (!claimResult.ok) {
        logger.error({ taskId: task.id, error: claimResult.error }, 'Failed to claim task for dispatch');
        return ok({ action: 'still_busy', taskId: task.id });
      }
      if (!claimResult.value) {
        logger.info({ taskId: task.id }, 'Skipped — claimed by another instance or no longer queued');
        return ok({ action: 'still_busy', taskId: task.id });
      }
      const affectedTasks = findAffectedDispatchTasks(activeCandidates, task);
      await recordDispatchBlockedForTask(deps, activeCandidates, task, dispatchability);
      const failResult = await failAffectedTasksForDispatchProblem(
        deps,
        affectedTasks,
        dispatchProblemFromBlocker(dispatchability),
      );
      if (!failResult.ok) {
        return err(failResult.error);
      }
      logger.warn(
        { userId: task.userId, taskId: task.id, reason: 'no_enabled_workers' },
        'Drain blocked: user has no enabled workers — task failed immediately',
      );
      return ok({ action: 'failed', taskId: task.id, locksToCleanup: buildLockCleanups(task) });
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

      if (linearIssueUuid === undefined) {
        logger.warn({ taskId: task.id, linearIssueId: task.linearIssueId }, 'Drain fan-out skipped: live parent UUID unavailable');
      } else {
        const directChildrenResult = await linearAgentClient.fetchDirectChildrenLive({
          userId: task.userId,
          issueId: linearIssueUuid,
        });

        if (directChildrenResult.ok) {
          const directChildren = directChildrenResult.value.filter((child) => child.parentId === linearIssueUuid);
          const fanOutResult = await fanOutChildTasks(
            {
              logger,
              codeTaskRepo,
              taskEnqueueService: deps.taskEnqueueService,
              orchestratorSecret: deps.orchestratorSecret,
            },
            {
              planningTask: task,
              userId: task.userId,
              childIssues: directChildren,
              workerType: task.workerType,
            },
          );

          if (fanOutResult.ok) {
            const cancelParentResult = await codeTaskRepo.update(task.id, {
              status: 'cancelled',
              completedAt: new Date(),
              error: {
                code: 'fan_out_parent_cancelled',
                message: 'Parent complex task replaced by direct child execution tasks',
              },
            });
            if (!cancelParentResult.ok) {
              logger.warn(
                { taskId: task.id, error: cancelParentResult.error },
                'Drain fan-out succeeded but failed to cancel parent task',
              );
            }

            logger.info(
              { taskId: task.id, childTaskIds: fanOutResult.value.childTaskIds },
              'Drain fan-out completed, parent task cancelled in favor of child execution tasks',
            );
            return ok({ action: 'dispatched', taskId: fanOutResult.value.primaryChildTaskId });
          }

          // Fan-out failed — fall through to normal dispatch
          logger.warn(
            { taskId: task.id, error: fanOutResult.error },
            'Drain fan-out failed, falling back to normal dispatch',
          );
        } else {
          logger.warn(
            { taskId: task.id, linearIssueId: task.linearIssueId, error: directChildrenResult.error },
            'Drain fan-out could not fetch live direct children, falling back to normal dispatch',
          );
        }
      }
    }

    const agentType = resolveTaskAgentType(task, linearIssueLabels);
    const dispatchLabels = ensureDispatchLabelsForAgentType(linearIssueLabels, agentType);
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
            taskId: task.id,
            errorCode: taskExecutionMemoryContext.errorCode,
            errorMessage: taskExecutionMemoryContext.errorMessage,
          },
          'Execution memory retrieval returned error status'
        );
      }

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

    // Guard: refuse to dispatch review/remediation tasks with prNumber but no prBranch —
    // these agents read code from the worktree and would silently check out the base branch
    // instead of the PR head, producing wrong review findings or fixing the wrong code.
    if (task.prNumber !== undefined && task.prBranch === undefined && (agentType === 'review' || agentType === 'remediation')) {
      const problem = missingPrBranchDispatchProblem({
        agentType,
        prNumber: task.prNumber,
      });
      const dispatchStatus = buildDispatchStatusForProblem({ task, problem });
      logger.error(
        { taskId: task.id, prNumber: task.prNumber, agentType },
        'Review/remediation task has prNumber but no prBranch — refusing to dispatch on base branch'
      );
      const updateResult = await codeTaskRepo.update(task.id, {
        status: 'failed',
        error: taskErrorFromDispatchStatus(dispatchStatus),
        dispatchStatus,
      });
      if (!updateResult.ok) {
        logger.error({ taskId: task.id, error: updateResult.error }, 'Failed to mark task failed after missing PR branch');
        return err({ code: 'internal_error', message: 'Failed to persist dispatch failure status' });
      }
      await reportOrNotifyDispatchProblem(deps, task, dispatchStatus, problem, 1, 'terminal');
      return ok({ action: 'failed', taskId: task.id, locksToCleanup: buildLockCleanups(task) });
    }

    // Atomic queued→dispatched claim — the process-local isDraining guard
    // does not cover multi-replica deployments (Cloud Run autoscaling).
    const claimResult = await codeTaskRepo.claimForDispatch(task.id);
    if (!claimResult.ok) {
      logger.error({ taskId: task.id, error: claimResult.error }, 'Failed to claim task for dispatch');
      return ok({ action: 'still_busy', taskId: task.id });
    }
    if (!claimResult.value) {
      logger.info({ taskId: task.id }, 'Skipped — claimed by another instance or no longer queued');
      return ok({ action: 'still_busy', taskId: task.id });
    }

    // Step 5: Attempt dispatch
    const webhookUrl = buildTaskCompleteWebhookUrl(config.codeTaskCallbackBaseUrl);

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
      ...(task.sentryIssue !== undefined && { sentryIssue: task.sentryIssue }),
      ...(task.prNumber !== undefined && task.prBranch !== undefined && {
        continuationPrNumber: task.prNumber,
        continuationPrBranch: task.prBranch,
      }),
      ...(task.linearIssueId !== undefined && { linearIssueId: task.linearIssueId }),
      // INT-949: Dispatch metadata fields from task document
      ...(task.trackingCommentId !== undefined && { trackingCommentId: task.trackingCommentId }),
      ...(task.retriedFrom !== undefined && { retriedFrom: task.retriedFrom }),
      ...(task.failedWorkerLocation !== undefined && { failedWorkerLocation: task.failedWorkerLocation }),
      ...(task.reviewTypes !== undefined && { reviewTypes: task.reviewTypes }),
      ...(dispatchExecutionMemoryContext !== undefined && {
        executionMemoryContext: dispatchExecutionMemoryContext,
      }),
      ...(task.prNumber !== undefined && { prNumber: task.prNumber }),
      // INT-1585: forward optional per-task timeout override to orchestrator
      ...(task.timeoutHours !== undefined && { timeoutHours: task.timeoutHours }),
    });

    if (!dispatchResult.ok) {
      const dispatchError = dispatchResult.error;
      const dispatchProblem = dispatchProblemFromError(dispatchError);

      if (dispatchError.blocker !== undefined) {
        await recordDispatchBlockedForTask(deps, activeCandidates, task, dispatchError.blocker);
      }

      // Recoverable dispatch problems keep the task queued. Do NOT reset
      // queuedAt — TTL is measured from queuedAt and resetting would defeat
      // the queue.ttlMinutes bound.
      if (!dispatchProblem.terminal) {
        logger.info(
          { taskId: task.id, error: dispatchError, retryable: dispatchError.code !== 'at_capacity' },
          'Dispatch transient/retryable, task remains queued',
        );
        const affectedTasks = dispatchError.blocker !== undefined
          ? findAffectedDispatchTasks(activeCandidates, task)
          : [task];
        const rollbackResult = await rollbackAffectedTasksForRecoverableDispatchProblem(
          deps,
          affectedTasks,
          dispatchProblem,
        );
        if (!rollbackResult.ok) {
          return err(rollbackResult.error);
        }
        return ok({ action: 'still_busy', taskId: task.id });
      }

      logger.error({ taskId: task.id, error: dispatchError }, 'Drain dispatch failed with permanent error');
      const affectedTasks = dispatchError.blocker !== undefined
        ? findAffectedDispatchTasks(activeCandidates, task)
        : [task];
      const failResult = await failAffectedTasksForDispatchProblem(deps, affectedTasks, dispatchProblem);
      if (!failResult.ok) {
        return err(failResult.error);
      }

      const locksToCleanup = buildLockCleanups(task);

      return ok({ action: 'failed', taskId: task.id, locksToCleanup });
    }

    // status and dispatchedAt are not written here — claimForDispatch already
    // set them transactionally before the network call.
    const cancelNonce = generateCancelNonce();
    const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();
    const callbackBaseUrl = normalizeCallbackBaseUrl(config.codeTaskCallbackBaseUrl);
    const now = new Date();

    const updateResult = await codeTaskRepo.update(task.id, {
      // Seed lastHeartbeat at dispatch so findZombieTasks (which uses a Firestore
      // inequality filter on lastHeartbeat) can sweep tasks that crash/fail
      // before the worker ever sends its first real heartbeat. Without this,
      // the field would be missing and the inequality filter would exclude the doc forever.
      lastHeartbeat: now,
      workerLocation: dispatchResult.value.workerLocation,
      cancelNonce,
      cancelNonceExpiresAt,
      dispatchStatus: null,
      callbackState: {
        webhookUrl,
        callbackBaseUrl,
        owner: classifyCallbackOwner(callbackBaseUrl),
        configuredAt: now,
      },
    });

    if (updateResult.ok) {
      await resolveDispatchBlockersForTask(deps, task);
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
