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
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { randomUUID } from 'node:crypto';
import { sanitizePrompt } from '../../domain/utils/promptSanitization.js';
import { resolveTaskAgentType } from '../../domain/utils/taskRouting.js';
import { generateWebhookSecret } from '../utils/secrets.js';
import {
  bootstrapContinuationPrTaskComment,
  resolveContinuationPr,
} from '../../domain/utils/continuationPr.js';
import type { AutomationLog } from '../../domain/ports/automationLog.js';

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
  taskEnqueueService: TaskEnqueueService;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
  orchestratorSecret: string;
  serviceUrl: string;
  automationLog: AutomationLog;
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
  const { logger, codeTaskRepo, linearAgentClient, taskEnqueueService, workerSettingsRepo } = deps;
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
  if (originalTask.status !== 'planned' && originalTask.status !== 'implemented' && originalTask.status !== 'reviewed') {
    logger.warn({ taskId: originalTask.id, status: originalTask.status }, 'Attempted to provide feedback on non-completed task');
    return err({
      code: 'invalid_status',
      message: `Cannot provide feedback on task with status "${originalTask.status}". Only completed tasks can receive feedback.`,
    });
  }

  // Step 3: Check for active tasks on same Linear issue (if exists)
  if (originalTask.linearIssueId !== undefined) {
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
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for feedback');
    return err({
      code: 'internal_error',
      message: 'Failed to fetch worker settings',
    });
  }

  const settings = settingsResult.value;

  // Handle null settings by providing empty array
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for feedback');
    return err({
      code: 'worker_not_configured',
      message: 'Please configure your workers in Settings before submitting feedback',
    });
  }

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

  if (originalTask.linearIssueId !== undefined) {
    const validateIssueResult = await linearAgentClient.validateIssue({
      userId,
      identifier: originalTask.linearIssueId,
    });

    if (validateIssueResult.ok) {
      linearIssueLabelsForDispatch = validateIssueResult.value.labels;
    } else {
      logger.warn(
        { linearIssueId: originalTask.linearIssueId },
        'Failed to fetch Linear issue labels for feedback dispatch'
      );
    }
  }

  const agentType = resolveTaskAgentType(originalTask, linearIssueLabelsForDispatch);

  // resolveTaskAgentType() already routes legacy PR-linked tasks back to execution
  // when they only carry prNumber, prBranch, or result.prUrl metadata.
  const continuationResult = await resolveContinuationPr(
    {
      logger,
      codeTaskRepo,
      gitHubPRClient: deps.gitHubPRClient,
      userServiceClient: deps.userServiceClient,
    },
    {
      task: originalTask,
      userId,
    }
  );

  if (!continuationResult.ok) {
    logger.error(
      { originalTaskId, userId, error: continuationResult.error },
      'Failed to resolve continuation PR for feedback task'
    );
    return err({
      code: 'internal_error',
      message: continuationResult.error.message,
    });
  }

  const continuationPr = continuationResult.value;

  // Step 8: Create follow-up task with parentTaskId
  const createInput = {
    id: followUpTaskId,
    userId,
    prompt: feedbackPrompt,
    sanitizedPrompt: sanitizePrompt(feedbackPrompt),
    systemPromptHash: originalTask.systemPromptHash,
    workerType: originalTask.workerType,
    workerLocation: 'queued',
    repository: originalTask.repository,
    baseBranch: originalTask.baseBranch,
    traceId: `feedback-${String(Date.now())}`,
    webhookSecret,
    parentTaskId: originalTask.id,
    followUpReason: 'user_feedback' as const,
    ...(originalTask.linearIssueId !== undefined && { linearIssueId: originalTask.linearIssueId }),
    ...(originalTask.actionId !== undefined && { actionId: originalTask.actionId }),
    ...(originalTask.approvalEventId !== undefined && { approvalEventId: originalTask.approvalEventId }),
    ...(continuationPr !== null && { prNumber: continuationPr.prNumber }),
    ...(continuationPr !== null && { prBranch: continuationPr.prBranch }),
    agentType,
  };

  const createResult = await codeTaskRepo.create(createInput);

  if (!createResult.ok) {
    logger.error({ error: createResult.error }, 'Failed to create follow-up task');
    return err({
      code: 'internal_error',
      message: 'Failed to create follow-up task',
    });
  }

  const followUpTask = createResult.value;

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
      task: followUpTask,
      userId,
      commentTitle: 'Execution Follow-up Task Created',
    }
  );

  if (!commentResult.ok) {
    logger.error(
      { taskId: followUpTask.id, originalTaskId, error: commentResult.error },
      'Failed to post continuation PR bootstrap comment for feedback task'
    );
    return err({
      code: 'internal_error',
      message: commentResult.error.message,
    });
  }

  logger.info(
    { originalTaskId: originalTask.id, followUpTaskId: followUpTask.id },
    'Follow-up task created from feedback'
  );

  // Step 9: Update Linear issue to In Progress (if exists)
  if (originalTask.linearIssueId !== undefined) {
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

  // Step 10: Enqueue task for dispatch
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: followUpTask.id,
    userId,
  });

  if (!enqueueResult.ok) {
    logger.error({ taskId: followUpTask.id, error: enqueueResult.error }, 'Failed to enqueue follow-up task');
    return err({
      code: 'internal_error',
      message: enqueueResult.error.message,
    });
  }

  logger.info(
    { taskId: followUpTask.id, queuePosition: enqueueResult.value.queuePosition },
    'Follow-up task enqueued'
  );

  return ok({
    codeTaskId: followUpTask.id,
    resourceUrl: `/#/code-tasks/${followUpTask.id}`,
    workerLocation: 'queued',
    followUpFor: originalTask.id,
  });
}
