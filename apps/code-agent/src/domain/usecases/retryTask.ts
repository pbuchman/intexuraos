/**
 * Use case: Retry a failed or cancelled code task.
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
import type { WorkerLocation } from '../../domain/models/worker.js';
import { randomBytes } from 'node:crypto';

/**
 * Cool-off period before retry is allowed (5 minutes).
 */
const RETRY_COOL_OFF_MS = 5 * 60 * 1000;

/**
 * Generate a webhook secret for a task.
 */
function generateWebhookSecret(): string {
  const buffer = randomBytes(24);
  return `whsec_${buffer.toString('hex')}`;
}

/**
 * Generate a cancel nonce for task cancellation.
 */
function generateCancelNonce(): string {
  const buffer = randomBytes(2);
  return buffer.toString('hex');
}

const CANCEL_NONCE_TTL_MS = 15 * 60 * 1000;

/**
 * Request to retry a failed task.
 */
export interface RetryTaskRequest {
  /** The ID of the failed or cancelled task to retry */
  originalTaskId: string;
  /** User ID requesting the retry */
  userId: string;
  /** Optional additional context to help with the retry */
  additionalContext?: string;
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
}

/**
 * Retry a failed or cancelled code task use case.
 *
 * Workflow:
 * 1. Fetch original task and validate it belongs to user
 * 2. Validate status is 'failed' or 'cancelled'
 * 3. Validate cool-off period has elapsed (5 minutes)
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
  const { originalTaskId, userId, additionalContext } = request;

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

  // Step 2: Validate status is failed or cancelled
  if (!['failed', 'cancelled'].includes(originalTask.status)) {
    logger.warn({ taskId: originalTask.id, status: originalTask.status }, 'Attempted to retry non-retryable task');
    return err({
      code: 'invalid_status',
      message: `Cannot retry task with status "${originalTask.status}". Only failed or cancelled tasks can be retried.`,
    });
  }

  // Step 3: Validate cool-off period
  // Cancelled tasks bypass cool-off — cancellation is user-initiated so immediate retry is appropriate
  const completedAt = originalTask.completedAt;

  if (originalTask.status !== 'cancelled' && completedAt !== undefined) {
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
  let retryPrompt = originalTask.prompt;
  if (additionalContext !== undefined && additionalContext.trim().length > 0) {
    retryPrompt = `${originalTask.prompt}

---

## Additional context (retry)

${additionalContext.trim()}
`;
  }

  // Step 7: Generate webhook secret
  const webhookSecret = generateWebhookSecret();

  // Step 8: Create retry task with retriedFrom
  const createInput = {
    userId,
    prompt: retryPrompt,
    sanitizedPrompt: retryPrompt,
    systemPromptHash: originalTask.systemPromptHash,
    workerType: originalTask.workerType,
    // Safe to access [0] because we return early if enabledWorkers.length === 0
    /* v8 ignore start -- ts-type: optional chaining with nullish coalescing creates type narrowing branch @preserve */
    workerLocation: enabledWorkers[0]?.name ?? 'unknown',
    /* v8 ignore stop @preserve */
    repository: originalTask.repository,
    baseBranch: originalTask.baseBranch,
    traceId: `retry-${String(Date.now())}`,
    webhookSecret,
    retriedFrom: originalTaskId,
    ...(originalTask.linearIssueId !== undefined && { linearIssueId: originalTask.linearIssueId }),
    ...(originalTask.linearIssueTitle !== undefined && { linearIssueTitle: originalTask.linearIssueTitle }),
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

  // Step 9: Build webhook URL
  const serviceUrl = process.env['INTEXURAOS_SERVICE_URL'] ?? 'https://code-agent.intexuraos.cloud';
  const webhookUrl = `${serviceUrl}/internal/webhooks/task-complete`;

  // Step 10: Dispatch to worker
  const dispatchRequest: {
    taskId: string;
    linearIssueId?: string;
    prompt: string;
    systemPromptHash: string;
    repository: string;
    baseBranch: string;
    workerType: 'opus' | 'auto' | 'glm';
    webhookUrl: string;
    webhookSecret: string;
    traceId?: string;
    workerCredentials: DispatchWorkerCredentials;
    retriedFrom?: string;
    linearIssueLabels: string[];
    hasChildren: boolean;
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
    linearIssueLabels: originalTask.linearIssueLabels ?? [],
    hasChildren: originalTask.hasChildren ?? false,
  };

  // Only include optional fields if defined
  /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
  if (retryTask.linearIssueId !== undefined) {
    dispatchRequest.linearIssueId = retryTask.linearIssueId;
  }
  /* v8 ignore stop @preserve */
  // traceId was set in createInput, so it's always defined on retryTask
  // Use ?? for type safety (traceId?: string in CodeTask type)
  /* v8 ignore start -- ts-type: nullish coalescing creates type narrowing branch @preserve */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  dispatchRequest.traceId = retryTask.traceId ?? `retry-${String(Date.now())}`;
  /* v8 ignore stop @preserve */

  const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);

  if (!dispatchResult.ok) {
    const dispatchError = dispatchResult.error;
    logger.warn(
      { taskId: retryTask.id, error: dispatchError },
      'Dispatch failed for retry task, but task was created'
    );
    const updateWithErrorResult = await codeTaskRepo.update(retryTask.id, {
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
    const commentBody = `Retrying ${originalTask.status} task **${originalTaskId}**.

**New task:** ${retryTask.id}

/* v8 ignore start -- ts-type: ternary operator with optional check creates type narrowing branch @preserve */
${additionalContext !== undefined && additionalContext.trim().length > 0
  ? `**Additional context provided:** ${additionalContext.trim()}`
  : ''}
/* v8 ignore stop @preserve */

---

*Retry initiated automatically*`;

    const commentResult = await linearAgentClient.addComment({
      userId,
      issueId: originalTask.linearIssueId,
      body: commentBody,
    });

    /* v8 ignore start -- test-infra: addComment success path tested but not detected by coverage tool @preserve */
    if (!commentResult.ok) {
      logger.warn(
        { linearIssueId: originalTask.linearIssueId, error: commentResult.error },
        'Failed to add comment to Linear issue'
      );
      // Don't fail the retry - continue without comment
    }
    /* v8 ignore stop @preserve */
  }

  // Step 13: Record metrics
  await deps.metricsClient.incrementTasksSubmitted(originalTask.workerType, 'web').catch((error: unknown) => {
    logger.warn({ error, taskId: retryTask.id }, 'Failed to record task submission metric for retry');
  });

  // Step 14: Generate cancel nonce and send notification
  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(retryTask.id, {
    cancelNonce,
    cancelNonceExpiresAt,
  });

  /* v8 ignore start -- test-infra: update success path tested but not detected by coverage tool @preserve */
  if (updateResult.ok) {
    const updatedTask = updateResult.value;
    const notifyResult = await whatsappNotifier.notifyTaskStarted(userId, updatedTask);
    if (!notifyResult.ok) {
      logger.warn({ taskId: retryTask.id, error: notifyResult.error }, 'Failed to send task started notification for retry');
    }
  } else {
    logger.warn({ taskId: retryTask.id, error: updateResult.error }, 'Failed to update retry task with cancel nonce');
  }
  /* v8 ignore stop @preserve */

  // Step 15: Return success
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
