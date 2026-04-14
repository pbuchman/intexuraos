/**
 * Use case: System-initiated auto-retry of a failed code task.
 *
 * Unlike retryTask (user-initiated), this is triggered automatically by
 * the failure triage system. It has:
 * - No user ownership validation (system-initiated)
 * - No cool-off period (except for rate-limit errors, handled by caller)
 * - Retry budget check via retriedFrom chain walking
 * - failedWorkerLocation to exclude on next dispatch
 *
 * INT-1375: Self-healing failure triage.
 */

import { err, ok, type Result, type Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import type { WhatsAppNotifier } from '../services/whatsappNotifier.js';
import { randomUUID } from 'node:crypto';
import { generateWebhookSecret } from '../utils/secrets.js';

const MAX_AUTO_RETRY_DEPTH = 3;

export interface AutoRetryTaskRequest {
  failedTask: CodeTask;
  failedWorkerLocation: string;
  reason: string;
}

export interface AutoRetryTaskResult {
  codeTaskId: string;
  autoRetryAttempt: number;
  failedWorkerLocation: string;
}

export type AutoRetryTaskErrorCode = 'budget_exhausted' | 'internal_error';

export interface AutoRetryTaskError {
  code: AutoRetryTaskErrorCode;
  message: string;
}

export interface AutoRetryTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskEnqueueService: TaskEnqueueService;
  whatsappNotifier: WhatsAppNotifier;
  orchestratorSecret: string;
}

/**
 * Count auto-retry depth by walking the retriedFrom chain.
 * Each hop increments depth by 1. Stops at MAX_AUTO_RETRY_DEPTH or chain end.
 */
async function countRetryDepth(
  codeTaskRepo: CodeTaskRepository,
  task: CodeTask
): Promise<number> {
  let depth = 0;
  let currentRetryFrom = task.retriedFrom;

  while (currentRetryFrom !== undefined && depth < MAX_AUTO_RETRY_DEPTH) {
    depth++;
    const parentResult = await codeTaskRepo.findById(currentRetryFrom);
    if (!parentResult.ok) {
      break;
    }
    currentRetryFrom = parentResult.value.retriedFrom;
  }

  return depth;
}

export async function autoRetryTask(
  deps: AutoRetryTaskDeps,
  request: AutoRetryTaskRequest
): Promise<Result<AutoRetryTaskResult, AutoRetryTaskError>> {
  const { logger, codeTaskRepo, taskEnqueueService, whatsappNotifier } = deps;
  const { failedTask, failedWorkerLocation, reason } = request;

  // Step 1: Check retry budget via chain walking
  const retryDepth = await countRetryDepth(codeTaskRepo, failedTask);
  const attemptNumber = retryDepth + 1;

  if (attemptNumber > MAX_AUTO_RETRY_DEPTH) {
    logger.info(
      { taskId: failedTask.id, retryDepth, maxDepth: MAX_AUTO_RETRY_DEPTH },
      'Auto-retry budget exhausted'
    );
    return err({
      code: 'budget_exhausted' as const,
      message: `Auto-retry budget exhausted after ${String(retryDepth)} attempts`,
    });
  }

  // Step 2: Create new retry task
  const retryTaskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, retryTaskId);

  const createResult = await codeTaskRepo.create({
    id: retryTaskId,
    webhookSecret,
    userId: failedTask.userId,
    prompt: failedTask.prompt,
    sanitizedPrompt: failedTask.sanitizedPrompt,
    systemPromptHash: failedTask.systemPromptHash,
    workerType: failedTask.workerType,
    workerLocation: 'queued',
    repository: failedTask.repository,
    baseBranch: failedTask.baseBranch,
    traceId: `auto-retry-${String(Date.now())}`,
    retriedFrom: failedTask.id,
    failedWorkerLocation,
    autoRetryAttempt: attemptNumber,
    ...(failedTask.agentType !== undefined && { agentType: failedTask.agentType }),
    ...(failedTask.linearIssueId !== undefined && { linearIssueId: failedTask.linearIssueId }),
    ...(failedTask.prNumber !== undefined && { prNumber: failedTask.prNumber }),
    ...(failedTask.prBranch !== undefined && { prBranch: failedTask.prBranch }),
  });

  if (!createResult.ok) {
    logger.error({ error: createResult.error, failedTaskId: failedTask.id }, 'Failed to create auto-retry task');
    return err({ code: 'internal_error' as const, message: `Failed to create auto-retry task: ${createResult.error.message}` });
  }

  // Step 3: Enqueue for dispatch
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: retryTaskId,
    userId: failedTask.userId,
  });

  if (!enqueueResult.ok) {
    logger.error({ error: enqueueResult.error, retryTaskId }, 'Failed to enqueue auto-retry task');
    return err({ code: 'internal_error' as const, message: enqueueResult.error.message });
  }

  // Step 4: Archive the failed task (the caller already wrote failure fields)
  const archiveResult = await codeTaskRepo.update(failedTask.id, { status: 'archived' });
  if (!archiveResult.ok) {
    logger.warn(
      { failedTaskId: failedTask.id, retryTaskId, error: archiveResult.error },
      'Failed to archive failed task after auto-retry (non-fatal)'
    );
  }

  // Step 5: Send WhatsApp notification
  await whatsappNotifier.notifyTaskAutoRetried(
    failedTask.userId,
    failedTask,
    { attempt: attemptNumber, maxAttempts: MAX_AUTO_RETRY_DEPTH, reason }
  );

  logger.info(
    { failedTaskId: failedTask.id, retryTaskId, attempt: attemptNumber, failedWorkerLocation, reason },
    'Auto-retry task created'
  );

  return ok({ codeTaskId: retryTaskId, autoRetryAttempt: attemptNumber, failedWorkerLocation });
}
