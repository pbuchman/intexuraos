/**
 * Use case: Retry a failed, cancelled, or interrupted code task.
 *
 * Creates a new task with the same prompt, optionally with additional context.
 * Links the new task to the original via retriedFrom field.
 *
 * INT-520: Retry mechanism for failed code agent tasks.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import type { TaskDispatcherService, DispatchWorkerCredentials } from '../../domain/services/taskDispatcher.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerType } from '../../domain/models/codeTask.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { randomUUID } from 'node:crypto';
import { sanitizePrompt } from '../../domain/utils/promptSanitization.js';
import { ensureDispatchLabelsForAgentType, resolveTaskAgentType } from '../../domain/utils/taskRouting.js';
import { generateWebhookSecret, generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
import {
  bootstrapContinuationPrTaskComment,
  resolveExecutionContinuationPr,
} from '../../domain/utils/continuationPr.js';
import { loadConfig } from '../../config.js';
import type { AutomationLog } from '../../domain/ports/automationLog.js';

/**
 * Cool-off period before retry is allowed (1 minute).
 */
const RETRY_COOL_OFF_MS = 1 * 60 * 1000;

/**
 * Request to retry a failed task.
 */
export interface RetryTaskRequest {
  /** The ID of the failed, cancelled, or interrupted task to retry */
  originalTaskId: string;
  /** User ID requesting the retry */
  userId: string;
  /** Optional additional context to help with the retry */
  additionalContext?: string;
  /** Optional worker type to use for the retry */
  workerType?: WorkerType;
}

/**
 * Successful result of retrying a task.
 */
export interface RetryTaskResult {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: WorkerLocation;
  retriedFrom: string;
}

/**
 * Error codes for retry task.
 */
export type RetryTaskErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'too_soon'
  | 'worker_not_configured'
  | 'queue_full'
  | 'internal_error';

/**
 * Error result from retrying a task.
 */
export interface RetryTaskError {
  code: RetryTaskErrorCode;
  message: string;
  retryAfterMs?: number;
}

export interface RetryTaskDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  orchestratorSecret: string;
  serviceUrl: string;
  automationLog: AutomationLog;
}

/**
 * Retry a failed, cancelled, or interrupted code task use case.
 *
 * Workflow:
 * 1. Fetch original task and validate it belongs to user
 * 2. Validate status is 'failed', 'cancelled', or 'interrupted'
 * 3. Validate cool-off period has elapsed (1 minute)
 * 4. Check for active tasks on same Linear issue
 * 5. Reconstruct prompt with additional context if provided
 * 6. Create new task with retriedFrom set
 * 7. Update Linear issue to In Progress
 * 8. Add comment to Linear issue with retry details
 * 9. Dispatch to worker
 * 10. Send WhatsApp notification
 */
export async function retryTask(
  deps: RetryTaskDeps,
  request: RetryTaskRequest
): Promise<Result<RetryTaskResult, RetryTaskError>> {
  const { logger, codeTaskRepo, linearAgentClient, taskDispatcher, whatsappNotifier, workerSettingsRepo } = deps;
  const { originalTaskId, userId, additionalContext, workerType } = request;

  // Step 1: Fetch original task
  const originalTaskResult = await codeTaskRepo.findByIdForUser(originalTaskId, userId);

  if (!originalTaskResult.ok) {
    logger.warn({ originalTaskId, userId, error: originalTaskResult.error }, 'Original task not found for retry');
    return err({
      code: 'task_not_found',
      message: `Task ${originalTaskId} not found`,
    });
  }

  const originalTask = originalTaskResult.value;

  // Step 2: Validate status is failed, cancelled, or interrupted
  if (!['failed', 'cancelled', 'interrupted'].includes(originalTask.status)) {
    logger.warn({ taskId: originalTask.id, status: originalTask.status }, 'Attempted to retry non-retryable task');
    return err({
      code: 'invalid_status',
      message: `Cannot retry task with status "${originalTask.status}". Only failed, cancelled, or interrupted tasks can be retried.`,
    });
  }

  // Step 3: Validate cool-off period
  // Cancelled and interrupted tasks bypass cool-off — cancellation is user-initiated and
  // interruption is infrastructure-related, so immediate retry is appropriate for both
  const completedAt = originalTask.completedAt;

  if (originalTask.status === 'failed' && completedAt !== undefined) {
    const now = Date.now();
    let completedAtTime: number;

    // completedAt can be Date or Timestamp - narrow to extract time
    /* v8 ignore start -- ts-type: instanceof check creates type narrowing branch @preserve */
    if (completedAt instanceof Date) {
      completedAtTime = completedAt.getTime();
    } else {
      // Must be Timestamp with toDate() method
      completedAtTime = completedAt.toDate().getTime();
    }
    /* v8 ignore stop @preserve */

    const timeSinceFailure = now - completedAtTime;

    if (timeSinceFailure < RETRY_COOL_OFF_MS) {
      const remainingMs = RETRY_COOL_OFF_MS - timeSinceFailure;
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));
      logger.info({ taskId: originalTask.id, remainingMs }, 'Retry attempted before cool-off period');
      return err({
        code: 'too_soon',
        message: `Please wait ${String(remainingMinutes)} minute(s) before retrying this task.`,
        retryAfterMs: remainingMs,
      });
    }
  }

  // Step 4: Check for active tasks on same Linear issue (if exists)
  if (originalTask.linearIssueId !== undefined) {
    const activeCheckResult = await codeTaskRepo.hasActiveTaskForLinearIssue(originalTask.linearIssueId);

    if (!activeCheckResult.ok) {
      // Log error but don't fail the retry - the active task check is best-effort
      // Better to allow retry than to block on a database check
      logger.error(
        { linearIssueId: originalTask.linearIssueId, error: activeCheckResult.error },
        'Failed to check for active tasks on Linear issue, proceeding with retry'
      );
    } else if (activeCheckResult.value.hasActive) {
      logger.warn(
        { linearIssueId: originalTask.linearIssueId, activeTaskId: activeCheckResult.value.taskId },
        'Cannot retry: active task exists for Linear issue'
      );
      return err({
        code: 'invalid_status',
        message: 'An active task already exists for this Linear issue. Please wait for it to complete.',
      });
    }
  }

  // Fetch fresh Linear issue metadata for dispatch (labels/child state not stored on task).
  let linearIssueLabelsForDispatch: string[] = [];
  let hasChildrenForDispatch = false;

  if (originalTask.linearIssueId !== undefined) {
    const validateIssueResult = await linearAgentClient.validateIssue({
      userId,
      identifier: originalTask.linearIssueId,
    });

    if (validateIssueResult.ok) {
      linearIssueLabelsForDispatch = validateIssueResult.value.labels;
      hasChildrenForDispatch = validateIssueResult.value.childCount > 0;
    } else {
      logger.warn(
        {
          linearIssueId: originalTask.linearIssueId,
          errorCode: validateIssueResult.error.code,
          errorMessage: validateIssueResult.error.message,
        },
        'Failed to refresh Linear issue labels for retry; dispatching with empty labels'
      );
    }
  }
  const agentType = resolveTaskAgentType(originalTask, linearIssueLabelsForDispatch);
  const dispatchLabels = ensureDispatchLabelsForAgentType(linearIssueLabelsForDispatch, agentType);

  // Step 5: Fetch user's worker settings
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for retry');
    return err({
      code: 'internal_error',
      message: 'Failed to fetch worker settings',
    });
  }

  const settings = settingsResult.value;

  // Handle null settings by providing empty array
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for retry');
    return err({
      code: 'worker_not_configured',
      message: 'Please configure your workers in Settings before retrying tasks',
    });
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

  // Step 6: Reconstruct prompt with additional context
  // Use sanitizedPrompt (what the original worker received) as the base, not the raw prompt,
  // to avoid re-exposing credentials that were already stripped on the first dispatch.
  let retryPrompt = originalTask.sanitizedPrompt;
  if (additionalContext !== undefined && additionalContext.trim().length > 0) {
    retryPrompt = `${originalTask.sanitizedPrompt}

---

## Additional context (retry)

${additionalContext.trim()}
`;
  }

  // Step 7: Pre-generate task ID and derive deterministic webhook secret
  const retryTaskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, retryTaskId);

  const continuationResult = await resolveExecutionContinuationPr(
    {
      logger,
      codeTaskRepo,
      gitHubPRClient: deps.gitHubPRClient,
      userServiceClient: deps.userServiceClient,
    },
    {
      agentType,
      task: originalTask,
      userId,
    }
  );

  if (!continuationResult.ok) {
    logger.error(
      { originalTaskId, userId, error: continuationResult.error },
      'Failed to resolve continuation PR for retry'
    );
    return err({
      code: 'internal_error',
      message: continuationResult.error.message,
    });
  }

  const continuationPr = continuationResult.value;

  // Step 8: Create retry task with retriedFrom
  // Use provided workerType if specified, otherwise use original task's workerType
  const effectiveWorkerType = workerType ?? originalTask.workerType;
  const createInput = {
    id: retryTaskId,
    userId,
    prompt: retryPrompt,
    sanitizedPrompt: sanitizePrompt(retryPrompt),
    systemPromptHash: originalTask.systemPromptHash,
    workerType: effectiveWorkerType,
    // Safe to access [0] because we return early if enabledWorkers.length === 0
    /* v8 ignore start -- ts-type: optional chaining with nullish coalescing creates type narrowing branch @preserve */
    workerLocation: enabledWorkers[0]?.name ?? 'unknown',
    /* v8 ignore stop @preserve */
    repository: originalTask.repository,
    baseBranch: originalTask.baseBranch,
    traceId: `retry-${String(Date.now())}`,
    webhookSecret,
    retriedFrom: originalTaskId,
    agentType,
    ...(originalTask.linearIssueId !== undefined && { linearIssueId: originalTask.linearIssueId }),
    ...(continuationPr !== null && { prNumber: continuationPr.prNumber }),
    ...(continuationPr !== null && { prBranch: continuationPr.prBranch }),
  };

  const createResult = await codeTaskRepo.create(createInput);

  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create retry task');
    return err({
      code: 'internal_error',
      message: `Failed to create retry task: ${createResult.error.message}`,
    });
  }

  const retryTask = createResult.value;

  const commentResult = await bootstrapContinuationPrTaskComment(
    {
      logger,
      codeTaskRepo,
      gitHubPRClient: deps.gitHubPRClient,
      userServiceClient: deps.userServiceClient,
      automationLog: deps.automationLog,
    },
    {
      continuationPr,
      task: retryTask,
      userId,
      commentTitle: 'Execution Retry Task Created',
    }
  );

  if (!commentResult.ok) {
    logger.error(
      { taskId: retryTask.id, originalTaskId, error: commentResult.error },
      'Failed to post continuation PR bootstrap comment for retry'
    );
    return err({
      code: 'internal_error',
      message: commentResult.error.message,
    });
  }

  // Step 9: Build webhook URL
  const webhookUrl = `${deps.serviceUrl}/internal/webhooks/task-complete`;

  // Step 10: Dispatch to worker
  const dispatchRequest: {
    taskId: string;
    linearIssueId?: string;
    prompt: string;
    systemPromptHash: string;
    repository: string;
    baseBranch: string;
    workerType: WorkerType;
    webhookUrl: string;
    webhookSecret: string;
    traceId?: string;
    workerCredentials: DispatchWorkerCredentials;
    retriedFrom?: string;
    linearIssueLabels: string[];
    hasChildren: boolean;
    agentType: 'planning' | 'execution' | 'pull_request' | 'review';
    continuationPrNumber?: number;
    continuationPrBranch?: string;
  } = {
    taskId: retryTask.id,
    prompt: retryTask.sanitizedPrompt,
    systemPromptHash: retryTask.systemPromptHash,
    repository: retryTask.repository,
    baseBranch: retryTask.baseBranch,
    workerType: retryTask.workerType,
    webhookUrl,
    webhookSecret,
    workerCredentials,
    retriedFrom: originalTaskId,
    linearIssueLabels: dispatchLabels,
    hasChildren: hasChildrenForDispatch,
    agentType: retryTask.agentType ?? 'planning',
    ...(continuationPr !== null && { continuationPrNumber: continuationPr.prNumber }),
    ...(continuationPr !== null && { continuationPrBranch: continuationPr.prBranch }),
  };

  // Only include optional fields if defined
  if (retryTask.linearIssueId !== undefined) {
    dispatchRequest.linearIssueId = retryTask.linearIssueId;
  }
  // traceId was set in createInput, so it's always defined on retryTask
  // Use ?? for type safety (traceId?: string in CodeTask type)
  /* v8 ignore start -- ts-type: nullish coalescing creates type narrowing branch @preserve */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  dispatchRequest.traceId = retryTask.traceId ?? `retry-${String(Date.now())}`;
  /* v8 ignore stop @preserve */

  const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);
  const config = loadConfig();

  if (!dispatchResult.ok) {
    const dispatchError = dispatchResult.error;

    // INT-619: Queue task when all workers are at capacity
    if (dispatchError.code === 'at_capacity') {
      const queueCountResult = await codeTaskRepo.countQueued();
      if (!queueCountResult.ok) {
        logger.error({ error: queueCountResult.error }, 'Failed to count queued tasks, treating as queue full');
      }
      const queueCount = queueCountResult.ok ? queueCountResult.value : config.queue.maxSize + 1;

      if (queueCount > config.queue.maxSize) {
        await codeTaskRepo.update(retryTask.id, {
          status: 'failed',
          error: {
            code: 'queue_full',
            message: `All workers are busy and the queue is full (${String(queueCount)}/${String(config.queue.maxSize)}). Please try again in a few minutes.`,
          },
        });

        return err({
          code: 'queue_full',
          message: 'All workers are busy and the queue is full. Please try again in a few minutes.',
        });
      }

      // Task is already in 'queued' status from creation — no status update needed
      const queuePosition = queueCount;
      const estimatedWaitMinutes = Math.min(queuePosition * 5, config.queue.ttlMinutes);
      await whatsappNotifier.notifyTaskQueued(userId, retryTask, queuePosition, estimatedWaitMinutes);

      logger.info({ taskId: retryTask.id, queuePosition }, 'Retry task queued due to worker capacity');

      return ok({
        codeTaskId: retryTask.id,
        resourceUrl: `/#/code-tasks/${retryTask.id}`,
        workerLocation: 'queued' as WorkerLocation,
        retriedFrom: originalTaskId,
      });
    }

    // Non-at_capacity dispatch errors — fail as before
    logger.warn(
      { taskId: retryTask.id, error: dispatchError },
      'Dispatch failed for retry task, but task was created'
    );
    const updateWithErrorResult = await codeTaskRepo.update(retryTask.id, {
      status: 'failed',
      error: {
        code: dispatchError.code,
        message: dispatchError.message,
      },
    });

    if (!updateWithErrorResult.ok) {
      logger.warn(
        { taskId: retryTask.id, error: updateWithErrorResult.error },
        'Failed to persist dispatch error on retry task'
      );
    }

    // Safe to access [0] because we return early if enabledWorkers.length === 0
    /* v8 ignore start -- ts-type: optional chaining with nullish coalescing creates type narrowing branch @preserve */
    const fallbackLocation = enabledWorkers[0]?.name ?? 'unknown';
    /* v8 ignore stop @preserve */

    return ok({
      codeTaskId: retryTask.id,
      resourceUrl: `/#/code-tasks/${retryTask.id}`,
      workerLocation: fallbackLocation,
      retriedFrom: originalTaskId,
    });
  }

  const dispatchValue = dispatchResult.value;

  // Step 11: Update Linear issue to In Progress
  if (originalTask.linearIssueId !== undefined) {
    const stateResult = await linearAgentClient.updateIssueState({
      userId,
      issueId: originalTask.linearIssueId,
      state: 'in_progress',
    });

    if (!stateResult.ok) {
      logger.warn(
        {
          linearIssueId: originalTask.linearIssueId,
          errorCode: stateResult.error.code,
          errorMessage: stateResult.error.message,
        },
        'Failed to update Linear issue to In Progress'
      );
      // Don't fail the retry - continue without Linear state update
    }

    // Step 12: Add comment to Linear issue
    // Sanitize additionalContext before embedding in Linear comment to prevent secret leakage
    /* v8 ignore start -- ts-type: ternary operator with optional check creates type narrowing branch @preserve */
    const additionalContextSection =
      additionalContext !== undefined && additionalContext.trim().length > 0
        ? `\n\n**Additional context provided:** ${sanitizePrompt(additionalContext.trim())}`
        : '';
    /* v8 ignore stop @preserve */

    const commentBody = `Retrying ${originalTask.status} task **${originalTaskId}**.

**New task:** ${retryTask.id}${additionalContextSection}

---

*Retry initiated automatically*`;

    const commentResult = await linearAgentClient.addComment({
      userId,
      issueId: originalTask.linearIssueId,
      body: commentBody,
    });

    if (!commentResult.ok) {
      logger.warn(
        { linearIssueId: originalTask.linearIssueId, error: commentResult.error },
        'Failed to add comment to Linear issue'
      );
      // Don't fail the retry - continue without comment
    }
  }

  // Step 13: Record metrics
  await deps.metricsClient.incrementTasksSubmitted(originalTask.workerType, 'web').catch((error: unknown) => {
    logger.warn({ error, taskId: retryTask.id }, 'Failed to record task submission metric for retry');
  });

  // Step 14: Generate cancel nonce and send notification
  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(retryTask.id, {
    status: 'dispatched',
    dispatchedAt: new Date(),
    workerLocation: dispatchValue.workerLocation,
    cancelNonce,
    cancelNonceExpiresAt,
  });

  if (updateResult.ok) {
    const updatedTask = updateResult.value;
    const notifyResult = await whatsappNotifier.notifyTaskStarted(userId, updatedTask);
    if (!notifyResult.ok) {
      logger.warn({ taskId: retryTask.id, error: notifyResult.error }, 'Failed to send task started notification for retry');
    }
  } else {
    logger.warn({ taskId: retryTask.id, error: updateResult.error }, 'Failed to update retry task with cancel nonce');
  }

  // Step 15: Archive original task (automatic cleanup on retry, INT-711)
  const archiveResult = await codeTaskRepo.update(originalTaskId, {
    status: 'archived',
  });
  if (!archiveResult.ok) {
    logger.warn(
      { originalTaskId, error: archiveResult.error },
      'Failed to archive original task after retry (non-fatal)'
    );
    // Don't fail the retry - archiving is best-effort cleanup
  }

  // Step 16: Return success
  logger.info(
    { originalTaskId, retryTaskId: retryTask.id, userId },
    'Task retry created successfully'
  );

  return ok({
    codeTaskId: retryTask.id,
    resourceUrl: `/#/code-tasks/${retryTask.id}`,
    workerLocation: dispatchValue.workerLocation,
    retriedFrom: originalTaskId,
  });
}
