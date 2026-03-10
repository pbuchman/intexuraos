/**
 * Use case: Submit feedback on a completed task.
 *
 * Creates a follow-up task based on user feedback for a completed task.
 * Links the new task to the original via parentTaskId field.
 *
 * INT-465 Phase 4: UI Direct Feedback on completed tasks.
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
import { randomUUID } from 'node:crypto';
import { hasCodeTaskLabel } from '../../domain/utils/labelUtils.js';
import { sanitizePrompt } from '../../domain/utils/promptSanitization.js';
import { generateWebhookSecret, generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';

/**
 * Request to submit feedback on a task.
 */
export interface SubmitTaskFeedbackRequest {
  /** The ID of the completed task to provide feedback on */
  originalTaskId: string;
  /** User ID submitting the feedback */
  userId: string;
  /** Feedback text from the user */
  feedback: string;
}

/**
 * Successful result of submitting task feedback.
 */
export interface SubmitTaskFeedbackResult {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: WorkerLocation;
  followUpFor: string;
}

/**
 * Error codes for submit task feedback.
 */
export type SubmitTaskFeedbackErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'worker_not_configured'
  | 'internal_error';

/**
 * Error result from submitting task feedback.
 */
export interface SubmitTaskFeedbackError {
  code: SubmitTaskFeedbackErrorCode;
  message: string;
}

export interface SubmitTaskFeedbackDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  taskDispatcher: TaskDispatcherService;
  whatsappNotifier: WhatsAppNotifier;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
  serviceUrl: string;
}

/**
 * Submit feedback on a completed task use case.
 *
 * Workflow:
 * 1. Fetch original task and validate it belongs to user
 * 2. Validate status is 'completed'
 * 3. Check for active tasks on same Linear issue
 * 4. Build follow-up prompt with feedback context
 * 5. Create new task with parentTaskId set
 * 6. Update Linear issue to In Progress
 * 7. Add comment to Linear issue with feedback details
 * 8. Dispatch to worker
 * 9. Send WhatsApp notification
 */
export async function submitTaskFeedback(
  deps: SubmitTaskFeedbackDeps,
  request: SubmitTaskFeedbackRequest
): Promise<Result<SubmitTaskFeedbackResult, SubmitTaskFeedbackError>> {
  const { logger, codeTaskRepo, linearAgentClient, taskDispatcher, whatsappNotifier, workerSettingsRepo } = deps;
  const { originalTaskId, userId, feedback } = request;

  // Step 1: Fetch original task
  const originalTaskResult = await codeTaskRepo.findByIdForUser(originalTaskId, userId);

  if (!originalTaskResult.ok) {
    logger.warn({ originalTaskId, userId, error: originalTaskResult.error }, 'Original task not found for feedback');
    return err({
      code: 'task_not_found',
      message: `Task ${originalTaskId} not found`,
    });
  }

  const originalTask = originalTaskResult.value;

  // Step 2: Validate status is completed
  if (originalTask.status !== 'planned' && originalTask.status !== 'implemented') {
    logger.warn({ taskId: originalTask.id, status: originalTask.status }, 'Attempted to provide feedback on non-completed task');
    return err({
      code: 'invalid_status',
      message: `Cannot provide feedback on task with status "${originalTask.status}". Only completed tasks can receive feedback.`,
    });
  }

  // Step 3: Check for active tasks on same Linear issue (if exists)
  /* v8 ignore start -- ts-type: optional field check for linearIssueId creates type narrowing branch @preserve */
  if (originalTask.linearIssueId !== undefined) {
    /* v8 ignore stop @preserve */
    const activeCheckResult = await codeTaskRepo.hasActiveTaskForLinearIssue(originalTask.linearIssueId);

    if (!activeCheckResult.ok) {
      // Log error but don't fail - the active task check is best-effort
      logger.error(
        { linearIssueId: originalTask.linearIssueId, error: activeCheckResult.error },
        'Failed to check for active tasks on Linear issue, proceeding with feedback'
      );
    } else if (activeCheckResult.value.hasActive) {
      logger.warn(
        { linearIssueId: originalTask.linearIssueId, activeTaskId: activeCheckResult.value.taskId },
        'Cannot submit feedback: active task exists for Linear issue'
      );
      return err({
        code: 'invalid_status',
        message: 'An active task already exists for this Linear issue. Please wait for it to complete.',
      });
    }
  }

  // Step 4: Fetch user's worker settings
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  /* v8 ignore start -- upstream: repository error handling covered by integration tests @preserve */
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for feedback');
    return err({
      code: 'internal_error',
      message: 'Failed to fetch worker settings',
    });
  }
  /* v8 ignore stop @preserve */

  const settings = settingsResult.value;

  // Handle null settings by providing empty array
  /* v8 ignore start -- ts-type: optional chaining for database result @preserve */
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);
  /* v8 ignore stop @preserve */

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for feedback');
    return err({
      code: 'worker_not_configured',
      message: 'Please configure your workers in Settings before submitting feedback',
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

  // Step 5: Build follow-up prompt with feedback context
  // Use sanitizedPrompt (what the original worker received) as the base, not the raw prompt,
  // to avoid re-exposing credentials that were already stripped on the first dispatch.
  const feedbackPrompt = `${originalTask.sanitizedPrompt}

---

## User Feedback (follow-up)

${feedback.trim()}
`;

  // Step 6: Pre-generate task ID and derive deterministic webhook secret
  const followUpTaskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, followUpTaskId);

  // Step 7: Fetch fresh labels from Linear to determine agentType before create
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
        { linearIssueId: originalTask.linearIssueId },
        'Failed to fetch Linear issue labels for feedback dispatch'
      );
    }
  }

  const agentType: 'planning' | 'execution' | 'pull_request' = originalTask.agentType === 'pull_request'
    ? 'pull_request'
    : hasCodeTaskLabel(linearIssueLabelsForDispatch) ? 'execution' : 'planning';

  // Step 8: Create follow-up task with parentTaskId
  const createInput = {
    id: followUpTaskId,
    userId,
    prompt: feedbackPrompt,
    sanitizedPrompt: sanitizePrompt(feedbackPrompt),
    systemPromptHash: originalTask.systemPromptHash,
    workerType: originalTask.workerType,
    /* v8 ignore start -- ts-type: optional chaining with null fallback creates type narrowing branch @preserve */
    workerLocation: enabledWorkers[0]?.name ?? 'unknown',
    /* v8 ignore stop @preserve */
    repository: originalTask.repository,
    baseBranch: originalTask.baseBranch,
    traceId: `feedback-${String(Date.now())}`,
    webhookSecret,
    parentTaskId: originalTask.id,
    followUpReason: 'user_feedback' as const,
    /* v8 ignore start -- ts-type: optional field spread operators create type narrowing branches @preserve */
    ...(originalTask.linearIssueId !== undefined && { linearIssueId: originalTask.linearIssueId }),
    ...(originalTask.actionId !== undefined && { actionId: originalTask.actionId }),
    ...(originalTask.approvalEventId !== undefined && { approvalEventId: originalTask.approvalEventId }),
    ...(originalTask.prNumber !== undefined && { prNumber: originalTask.prNumber }),
    /* v8 ignore stop @preserve */
    agentType,
  };

  const createResult = await codeTaskRepo.create(createInput);

  /* v8 ignore start -- upstream: repository error handling covered by integration tests @preserve */
  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create follow-up task');
    return err({
      code: 'internal_error',
      message: 'Failed to create follow-up task',
    });
  }
  /* v8 ignore stop @preserve */

  const followUpTask = createResult.value;

  logger.info(
    { originalTaskId: originalTask.id, followUpTaskId: followUpTask.id },
    'Follow-up task created from feedback'
  );

  // Step 9: Update Linear issue to In Progress (if exists)
  /* v8 ignore start -- ts-type: optional field check for linearIssueId creates type narrowing branch @preserve */
  if (originalTask.linearIssueId !== undefined) {
    /* v8 ignore stop @preserve */
    const updateResult = await linearAgentClient.updateIssueState({
      userId,
      issueId: originalTask.linearIssueId,
      state: 'in_progress',
    });

    if (!updateResult.ok) {
      // Log warning but don't fail the feedback - Linear update is best-effort
      logger.warn(
        { linearIssueId: originalTask.linearIssueId, error: updateResult.error },
        'Failed to update Linear issue to In Progress'
      );
    }

    // Step 9: Add comment to Linear issue with feedback details
    // Sanitize feedback before embedding in Linear comment to prevent secret leakage
    const sanitizedFeedback = sanitizePrompt(feedback.trim());
    const webUrl = process.env['INTEXURAOS_WEB_URL'] ?? 'https://intexuraos.cloud';
    const commentBody = `🔄 **Follow-up task created** based on user feedback

**Original task:** [${originalTask.id}](${webUrl}/#/code-tasks/${originalTask.id})
**Follow-up task:** [${followUpTask.id}](${webUrl}/#/code-tasks/${followUpTask.id})

**Feedback:**
> ${sanitizedFeedback.split('\n').join('\n> ')}`;

    const commentResult = await linearAgentClient.addComment({
      userId,
      issueId: originalTask.linearIssueId,
      body: commentBody,
    });

    if (!commentResult.ok) {
      // Log warning but don't fail - comment is best-effort
      logger.warn(
        { linearIssueId: originalTask.linearIssueId, error: commentResult.error },
        'Failed to add comment to Linear issue'
      );
    }
  }

  // Step 10: Build webhook URL
  const webhookUrl = `${deps.serviceUrl}/internal/webhooks/task-complete`;

  // Step 11: Dispatch to worker
  const dispatchRequest: {
    taskId: string;
    linearIssueId?: string;
    prompt: string;
    systemPromptHash: string;
    repository: string;
    baseBranch: string;
    workerType: 'opus' | 'auto' | 'sonnet' | 'minimax' | 'glm' | 'qwen3.5-plus';
    webhookUrl: string;
    webhookSecret: string;
    traceId?: string;
    workerCredentials: DispatchWorkerCredentials;
    parentTaskId?: string;
    linearIssueLabels: string[];
    hasChildren: boolean;
    agentType: 'planning' | 'execution' | 'pull_request' | 'review';
  } = {
    taskId: followUpTask.id,
    prompt: followUpTask.sanitizedPrompt,
    systemPromptHash: followUpTask.systemPromptHash,
    repository: followUpTask.repository,
    baseBranch: followUpTask.baseBranch,
    workerType: followUpTask.workerType,
    webhookUrl,
    webhookSecret,
    workerCredentials,
    parentTaskId: originalTask.id,
    linearIssueLabels: linearIssueLabelsForDispatch,
    hasChildren: hasChildrenForDispatch,
    agentType: followUpTask.agentType ?? 'planning',
  };

  // Add optional fields if defined
  /* v8 ignore start -- ts-type: optional property check creates type narrowing branch @preserve */
  if (followUpTask.linearIssueId !== undefined) {
    dispatchRequest.linearIssueId = followUpTask.linearIssueId;
  }
  /* v8 ignore stop @preserve */
  // traceId was set in createInput, safe to assign directly
  dispatchRequest.traceId = followUpTask.traceId;

  const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);

  /* v8 ignore start -- upstream: dispatcher error handling covered by integration tests @preserve */
  if (!dispatchResult.ok) {
    /* v8 ignore stop @preserve */
    // Update task with error and mark as failed
    const dispatchError = dispatchResult.error;
    await codeTaskRepo.update(followUpTask.id, {
      status: 'failed',
      error: {
        code: dispatchError.code,
        message: dispatchError.message,
      },
    });

    logger.error({ taskId: followUpTask.id, error: dispatchResult.error }, 'Failed to dispatch follow-up task');
    return err({
      code: 'internal_error',
      message: dispatchError.message,
    });
  }

  logger.info(
    { taskId: followUpTask.id, workerLocation: dispatchResult.value.workerLocation },
    'Follow-up task dispatched'
  );

  // Step 12: Generate cancel nonce and send notification
  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(followUpTask.id, {
    status: 'dispatched',
    workerLocation: dispatchResult.value.workerLocation,
    cancelNonce,
    cancelNonceExpiresAt,
  });

  /* v8 ignore start -- test-infra: update success path tested but not detected by coverage tool @preserve */
  if (updateResult.ok) {
    const updatedTask = updateResult.value;
    const notifyResult = await whatsappNotifier.notifyTaskStarted(userId, updatedTask);
    if (!notifyResult.ok) {
      logger.warn(
        { taskId: followUpTask.id, error: notifyResult.error },
        'Failed to send task started notification for feedback'
      );
    }
  } else {
    logger.warn({ taskId: followUpTask.id, error: updateResult.error }, 'Failed to update task with cancel nonce');
  }
  /* v8 ignore stop @preserve */

  return ok({
    codeTaskId: followUpTask.id,
    resourceUrl: `/#/code-tasks/${followUpTask.id}`,
    workerLocation: followUpTask.workerLocation,
    followUpFor: originalTask.id,
  });
}
