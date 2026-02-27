/**
 * Use case: Start Phase 2 implementation from a completed Phase 1 design task.
 *
 * Validates that the Linear issue has the 'code-task' label (set by Phase 1),
 * then dispatches a Phase 2 strict-execution task.
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
import { hasCodeTaskLabel, hasUnclearLabel } from '../../domain/utils/labelUtils.js';
import { randomUUID } from 'node:crypto';
import { generateWebhookSecret, generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';

export const PHASE2_PROMPT =
  'Implement the requirements defined in the linked Linear issue. Follow the test plan, write code, run CI, and create a PR.';

/**
 * Request to start Phase 2 implementation from a completed Phase 1 design task.
 */
export interface SubmitToPhase2Request {
  /** The ID of the completed Phase 1 design task */
  originalTaskId: string;
  /** User ID submitting the request */
  userId: string;
}

/**
 * Successful result of submitting to Phase 2.
 */
export interface SubmitToPhase2Result {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: WorkerLocation;
  implementationOf: string;
}

/**
 * Error codes for submit to Phase 2.
 */
export type SubmitToPhase2ErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'no_linear_issue'
  | 'already_implemented'
  | 'active_task_exists'
  | 'label_not_ready'
  | 'worker_not_configured'
  | 'internal_error';

/**
 * Error result from submitting to Phase 2.
 */
export interface SubmitToPhase2Error {
  code: SubmitToPhase2ErrorCode;
  message: string;
  /** Only set for already_implemented */
  existingTaskId?: string;
}

export interface SubmitToPhase2Deps {
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
 * Submit to Phase 2 use case.
 *
 * Workflow:
 * 1. Fetch original task and validate it belongs to user
 * 2. Validate status is 'completed' and executionPhase is 'design'
 * 3. Validate task has a linked Linear issue
 * 4. Guard against duplicate implementation
 * 5. Check for active tasks on same Linear issue
 * 6. Fetch worker settings
 * 7. Validate Linear issue labels (must have 'code-task', must not have 'unclear')
 * 8. Optimistic lock: set implementationTaskId before dispatch
 * 9. Create Phase 2 task
 * 10. Update Linear issue to In Progress + add comment
 * 11. Build and dispatch to worker
 * 12. Rollback on dispatch failure
 * 13. Generate cancel nonce and send WhatsApp notification
 */
export async function submitToPhase2(
  deps: SubmitToPhase2Deps,
  request: SubmitToPhase2Request
): Promise<Result<SubmitToPhase2Result, SubmitToPhase2Error>> {
  const { logger, codeTaskRepo, linearAgentClient, taskDispatcher, whatsappNotifier, workerSettingsRepo } = deps;
  const { originalTaskId, userId } = request;

  // Step 1: Fetch original task
  const originalTaskResult = await codeTaskRepo.findByIdForUser(originalTaskId, userId);

  if (!originalTaskResult.ok) {
    logger.warn({ originalTaskId, userId, error: originalTaskResult.error }, 'Original task not found for Phase 2 submission');
    return err({
      code: 'task_not_found',
      message: `Task ${originalTaskId} not found`,
    });
  }

  const originalTask = originalTaskResult.value;

  // Step 2: Validate status is 'designed' and executionPhase is 'design'
  if (originalTask.status !== 'designed' || originalTask.executionPhase !== 'design') {
    logger.warn(
      { taskId: originalTask.id, status: originalTask.status, executionPhase: originalTask.executionPhase },
      'Attempted to start Phase 2 on non-designed task'
    );
    return err({
      code: 'invalid_status',
      message: 'Task must be a completed design task to start implementation',
    });
  }

  // Step 3: Validate task has a linked Linear issue
  if (originalTask.linearIssueId === undefined) {
    logger.warn({ taskId: originalTask.id }, 'Cannot start Phase 2: task has no linked Linear issue');
    return err({
      code: 'no_linear_issue',
      message: 'Cannot implement — this task has no linked Linear issue',
    });
  }

  const linearIssueId = originalTask.linearIssueId;

  // Step 4: Guard against duplicate implementation
  if (originalTask.implementationTaskId !== undefined) {
    logger.warn(
      { taskId: originalTask.id, existingImplementationTaskId: originalTask.implementationTaskId },
      'Implementation already started for this task'
    );
    return err({
      code: 'already_implemented',
      message: 'Implementation already started',
      existingTaskId: originalTask.implementationTaskId,
    });
  }

  // Step 5: Check for active tasks on same Linear issue (best-effort)
  const activeCheckResult = await codeTaskRepo.hasActiveTaskForLinearIssue(linearIssueId);

  if (!activeCheckResult.ok) {
    // Log error but don't fail - the active task check is best-effort
    logger.error(
      { linearIssueId, error: activeCheckResult.error },
      'Failed to check for active tasks on Linear issue, proceeding with Phase 2 submission'
    );
  } else if (activeCheckResult.value.hasActive) {
    logger.warn(
      { linearIssueId, activeTaskId: activeCheckResult.value.taskId },
      'Cannot start Phase 2: active task exists for Linear issue'
    );
    return err({
      code: 'active_task_exists',
      message: 'An active task already exists for this Linear issue',
    });
  }

  // Step 6: Fetch user's worker settings
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  /* v8 ignore start -- upstream: repository error handling covered by integration tests @preserve */
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for Phase 2 submission');
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
    logger.warn({ userId }, 'User has no workers configured for Phase 2 submission');
    return err({
      code: 'worker_not_configured',
      message: 'No workers configured. Configure workers in Settings.',
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

  // Step 7: Fetch fresh labels from Linear and validate
  const validateResult = await linearAgentClient.validateIssue({
    userId,
    identifier: linearIssueId,
  });

  if (!validateResult.ok) {
    logger.warn(
      { linearIssueId, error: validateResult.error },
      'Failed to fetch Linear issue labels for Phase 2 submission'
    );
    return err({
      code: 'label_not_ready',
      message: 'Failed to fetch Linear issue labels. Please try again.',
    });
  }

  const freshLabels = validateResult.value.labels;
  const hasChildrenForDispatch = validateResult.value.childCount > 0;

  // Step 8: Check labels
  if (hasUnclearLabel(freshLabels)) {
    logger.warn({ linearIssueId, labels: freshLabels }, 'Linear issue has unclear label, cannot proceed to Phase 2');
    return err({
      code: 'label_not_ready',
      message: 'The design phase flagged questions that need resolution. Review the Linear issue, address open questions, then retry the design phase.',
    });
  } else if (!hasCodeTaskLabel(freshLabels)) {
    logger.warn({ linearIssueId, labels: freshLabels }, 'Linear issue missing code-task label, Phase 1 may not have completed successfully');
    return err({
      code: 'label_not_ready',
      message: "The code-task label hasn't been added yet. The design phase may not have completed successfully.",
    });
  }

  // Step 9: SET implementationTaskId on Phase 1 task BEFORE dispatch (optimistic lock)
  const phase2TaskId = `task_${randomUUID()}`;

  const lockResult = await codeTaskRepo.update(originalTask.id, {
    implementationTaskId: phase2TaskId,
  });

  if (!lockResult.ok) {
    logger.error({ taskId: originalTask.id, error: lockResult.error }, 'Failed to set optimistic lock for Phase 2 implementation');
    return err({
      code: 'internal_error',
      message: 'Failed to start implementation',
    });
  }

  // Step 10: Create the Phase 2 task
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, phase2TaskId);
  const createInput = {
    id: phase2TaskId,
    userId,
    prompt: PHASE2_PROMPT,
    sanitizedPrompt: PHASE2_PROMPT,
    systemPromptHash: originalTask.systemPromptHash,
    workerType: originalTask.workerType,
    /* v8 ignore start -- ts-type: optional chaining with null fallback creates type narrowing branch @preserve */
    workerLocation: enabledWorkers[0]?.name ?? 'unknown',
    /* v8 ignore stop @preserve */
    repository: originalTask.repository,
    baseBranch: originalTask.baseBranch,
    traceId: `phase2-${originalTask.traceId}`,
    webhookSecret,
    parentTaskId: originalTask.id,
    followUpReason: 'phase2_implement' as const,
    executionPhase: 'execution' as const,
    linearIssueId,
    /* v8 ignore start -- ts-type: optional field spread operators create type narrowing branches @preserve */
    ...(originalTask.linearIssueTitle !== undefined && { linearIssueTitle: originalTask.linearIssueTitle }),
    ...(originalTask.linearIssueUrl !== undefined && { linearIssueUrl: originalTask.linearIssueUrl }),
    ...(originalTask.linearFallback !== undefined && { linearFallback: originalTask.linearFallback }),
    /* v8 ignore stop @preserve */
  };

  const createResult = await codeTaskRepo.create(createInput);

  /* v8 ignore start -- upstream: repository error handling covered by integration tests @preserve */
  if (!createResult.ok) {
    // Rollback the optimistic lock
    logger.error({ error: createResult.error }, 'Failed to create Phase 2 task, rolling back optimistic lock');
    const lockRollbackResult = await codeTaskRepo.update(originalTask.id, { implementationTaskId: null });
    if (!lockRollbackResult.ok) {
      logger.error(
        { taskId: originalTask.id, error: lockRollbackResult.error },
        'Failed to rollback implementationTaskId after create failure'
      );
    }
    return err({
      code: 'internal_error',
      message: 'Failed to create Phase 2 task',
    });
  }
  /* v8 ignore stop @preserve */

  const phase2Task = createResult.value;

  logger.info(
    { originalTaskId: originalTask.id, phase2TaskId: phase2Task.id },
    'Phase 2 task created'
  );

  // Step 11: Update Linear issue to In Progress + add comment (best-effort)
  const updateIssueResult = await linearAgentClient.updateIssueState({
    userId,
    issueId: linearIssueId,
    state: 'in_progress',
  });

  if (!updateIssueResult.ok) {
    logger.warn(
      { linearIssueId, error: updateIssueResult.error },
      'Failed to update Linear issue to In Progress for Phase 2'
    );
  }

  const webUrl = process.env['INTEXURAOS_WEB_URL'] ?? 'https://intexuraos.cloud';
  const commentBody = `🚀 **Phase 2 implementation started**

**Design task:** [${originalTask.id}](${webUrl}/#/code-tasks/${originalTask.id})
**Implementation task:** [${phase2TaskId}](${webUrl}/#/code-tasks/${phase2TaskId})`;

  const commentResult = await linearAgentClient.addComment({
    userId,
    issueId: linearIssueId,
    body: commentBody,
  });

  if (!commentResult.ok) {
    logger.warn(
      { linearIssueId, error: commentResult.error },
      'Failed to add Phase 2 start comment to Linear issue'
    );
  }

  // Step 12: Build dispatch request and dispatch
  const webhookUrl = `${deps.serviceUrl}/internal/webhooks/task-complete`;

  const dispatchRequest = {
    taskId: phase2TaskId,
    linearIssueId,
    linearIssueLabels: freshLabels,
    hasChildren: hasChildrenForDispatch,
    prompt: phase2Task.sanitizedPrompt,
    systemPromptHash: phase2Task.systemPromptHash,
    repository: phase2Task.repository,
    baseBranch: phase2Task.baseBranch,
    workerType: phase2Task.workerType,
    webhookUrl,
    /* v8 ignore start -- ts-type: nullish coalescing on webhookSecret which is always set at task creation @preserve */
    webhookSecret: phase2Task.webhookSecret ?? '',
    /* v8 ignore stop @preserve */
    traceId: phase2Task.traceId,
    workerCredentials,
    /* v8 ignore start -- ts-type: fallback branch for backward compatibility @preserve */
    executionPhase: phase2Task.executionPhase ?? (hasCodeTaskLabel(freshLabels) ? 'execution' : 'design'),
    /* v8 ignore stop @preserve */
  };

  const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);

  /* v8 ignore start -- upstream: dispatcher error handling covered by integration tests @preserve */
  if (!dispatchResult.ok) {
    /* v8 ignore stop @preserve */
    // Step 13: Rollback on dispatch failure
    const dispatchError = dispatchResult.error;
    logger.error({ taskId: phase2TaskId, error: dispatchError }, 'Failed to dispatch Phase 2 task, rolling back');

    // Roll back optimistic lock on Phase 1 task
    const lockRollbackResult = await codeTaskRepo.update(originalTask.id, { implementationTaskId: null });
    /* v8 ignore start -- upstream: Firestore write failure within dispatch failure path @preserve */
    if (!lockRollbackResult.ok) {
      logger.error(
        { taskId: originalTask.id, phase2TaskId, error: lockRollbackResult.error },
        'Failed to rollback implementationTaskId after dispatch failure'
      );
    }
    /* v8 ignore stop @preserve */

    // Mark Phase 2 task as failed
    const failMarkResult = await codeTaskRepo.update(phase2TaskId, {
      status: 'failed',
      error: {
        code: dispatchError.code,
        message: dispatchError.message,
      },
    });
    /* v8 ignore start -- upstream: Firestore write failure within dispatch failure path @preserve */
    if (!failMarkResult.ok) {
      logger.error(
        { phase2TaskId, error: failMarkResult.error },
        'Failed to mark Phase 2 task as failed after dispatch failure'
      );
    }
    /* v8 ignore stop @preserve */

    return err({
      code: 'internal_error',
      message: dispatchError.message,
    });
  }

  logger.info(
    { taskId: phase2TaskId, workerLocation: dispatchResult.value.workerLocation },
    'Phase 2 task dispatched'
  );

  // Step 14: Generate cancel nonce and send WhatsApp notification
  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(phase2TaskId, {
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
        { taskId: phase2TaskId, error: notifyResult.error },
        'Failed to send task started notification for Phase 2'
      );
    }
  } else {
    logger.warn({ taskId: phase2TaskId, error: updateResult.error }, 'Failed to update Phase 2 task with cancel nonce');
  }
  /* v8 ignore stop @preserve */

  // Step 15: Return success
  return ok({
    codeTaskId: phase2TaskId,
    resourceUrl: `/#/code-tasks/${phase2TaskId}`,
    workerLocation: dispatchResult.value.workerLocation,
    implementationOf: originalTask.id,
  });
}
