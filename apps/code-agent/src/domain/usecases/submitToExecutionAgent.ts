/**
 * Use case: Start Execution Agent implementation from a completed planning design task.
 *
 * Validates that the Linear issue has the 'code-task' label (set by planning),
 * then dispatches an Execution Agent strict-execution task.
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
import { hasCodeTaskLabel, hasUnclearLabel } from '../../domain/utils/labelUtils.js';
import { randomUUID } from 'node:crypto';
import { generateWebhookSecret, generateCancelNonce, CANCEL_NONCE_TTL_MS } from '../utils/secrets.js';
import { loadConfig } from '../../config.js';

export const EXECUTION_AGENT_PROMPT =
  'Implement the requirements defined in the linked Linear issue and its comments (newest first). Follow the test plan, write code, run CI, and create a PR.';

/**
 * Request to start Execution Agent implementation from a completed planning design task.
 */
export interface SubmitToExecutionAgentRequest {
  /** The ID of the completed planning design task */
  originalTaskId: string;
  /** User ID submitting the request */
  userId: string;
  /** Optional worker type to use for the implementation */
  workerType?: WorkerType;
}

/**
 * Successful result of submitting to Execution Agent.
 */
export interface SubmitToExecutionAgentResult {
  codeTaskId: string;
  resourceUrl: string;
  workerLocation: WorkerLocation;
  implementationOf: string;
}

/**
 * Error codes for submit to Execution Agent.
 */
export type SubmitToExecutionAgentErrorCode =
  | 'task_not_found'
  | 'invalid_status'
  | 'no_linear_issue'
  | 'already_implemented'
  | 'active_task_exists'
  | 'label_not_ready'
  | 'worker_not_configured'
  | 'queue_full'
  | 'internal_error';

/**
 * Error result from submitting to Execution Agent.
 */
export interface SubmitToExecutionAgentError {
  code: SubmitToExecutionAgentErrorCode;
  message: string;
  /** Only set for already_implemented */
  existingTaskId?: string;
}

export interface SubmitToExecutionAgentDeps {
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
 * Submit to Execution Agent use case.
 *
 * Workflow:
 * 1. Fetch original task and validate it belongs to user
 * 2. Validate status is 'planned' and agentType is 'planning'
 * 3. Validate task has a linked Linear issue
 * 4. Guard against duplicate implementation
 * 5. Check for active tasks on same Linear issue
 * 6. Fetch worker settings
 * 7. Validate Linear issue labels (must have 'code-task', must not have 'unclear')
 * 8. Optimistic lock: set implementationTaskId before dispatch
 * 9. Create Execution Agent task
 * 10. Update Linear issue to In Progress + add comment
 * 11. Build and dispatch to worker
 * 12. Rollback on dispatch failure
 * 13. Generate cancel nonce and send WhatsApp notification
 */
export async function submitToExecutionAgent(
  deps: SubmitToExecutionAgentDeps,
  request: SubmitToExecutionAgentRequest
): Promise<Result<SubmitToExecutionAgentResult, SubmitToExecutionAgentError>> {
  const { logger, codeTaskRepo, linearAgentClient, taskDispatcher, whatsappNotifier, workerSettingsRepo } = deps;
  const { originalTaskId, userId, workerType } = request;

  // Step 1: Fetch original task
  const originalTaskResult = await codeTaskRepo.findByIdForUser(originalTaskId, userId);

  if (!originalTaskResult.ok) {
    logger.warn({ originalTaskId, userId, error: originalTaskResult.error }, 'Original task not found for Execution Agent submission');
    return err({
      code: 'task_not_found',
      message: `Task ${originalTaskId} not found`,
    });
  }

  const originalTask = originalTaskResult.value;

  // Step 2: Validate status is 'planned' and agentType is 'planning'
  if (originalTask.status !== 'planned' || originalTask.agentType !== 'planning') {
    logger.warn(
      { taskId: originalTask.id, status: originalTask.status, agentType: originalTask.agentType },
      'Attempted to start Execution Agent on non-planning task'
    );
    return err({
      code: 'invalid_status',
      message: 'Task must be a completed planning task to start implementation',
    });
  }

  // Step 3: Validate task has a linked Linear issue
  if (originalTask.linearIssueId === undefined) {
    logger.warn({ taskId: originalTask.id }, 'Cannot start Execution Agent: task has no linked Linear issue');
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
      'Failed to check for active tasks on Linear issue, proceeding with Execution Agent submission'
    );
  } else if (activeCheckResult.value.hasActive) {
    logger.warn(
      { linearIssueId, activeTaskId: activeCheckResult.value.taskId },
      'Cannot start Execution Agent: active task exists for Linear issue'
    );
    return err({
      code: 'active_task_exists',
      message: 'An active task already exists for this Linear issue',
    });
  }

  // Step 6: Fetch user's worker settings
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for Execution Agent submission');
    return err({
      code: 'internal_error',
      message: 'Failed to fetch worker settings',
    });
  }

  const settings = settingsResult.value;

  // Handle null settings by providing empty array
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);

  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for Execution Agent submission');
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
      'Failed to fetch Linear issue labels for Execution Agent submission'
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
    logger.warn({ linearIssueId, labels: freshLabels }, 'Linear issue has unclear label, cannot proceed to Execution Agent');
    return err({
      code: 'label_not_ready',
      message: 'The planning agent flagged questions that need resolution. Review the Linear issue, address open questions, then retry the planning agent.',
    });
  } else if (!hasCodeTaskLabel(freshLabels)) {
    logger.warn({ linearIssueId, labels: freshLabels }, 'Linear issue missing code-task label, planning may not have completed successfully');
    return err({
      code: 'label_not_ready',
      message: "The code-task label hasn't been added yet. The planning agent may not have completed successfully.",
    });
  }

  // Step 9: SET implementationTaskId on planning task BEFORE dispatch (optimistic lock)
  const executionTaskId = `task_${randomUUID()}`;

  const lockResult = await codeTaskRepo.update(originalTask.id, {
    implementationTaskId: executionTaskId,
  });

  if (!lockResult.ok) {
    logger.error({ taskId: originalTask.id, error: lockResult.error }, 'Failed to set optimistic lock for Execution Agent implementation');
    return err({
      code: 'internal_error',
      message: 'Failed to start implementation',
    });
  }

  // Step 10: Create the Execution Agent task
  // Use provided workerType if specified, otherwise use original task's workerType
  const effectiveWorkerType = workerType ?? originalTask.workerType;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, executionTaskId);
  const createInput = {
    id: executionTaskId,
    userId,
    prompt: EXECUTION_AGENT_PROMPT,
    sanitizedPrompt: EXECUTION_AGENT_PROMPT,
    systemPromptHash: originalTask.systemPromptHash,
    workerType: effectiveWorkerType,
    /* v8 ignore start -- ts-type: optional chaining with null fallback creates type narrowing branch @preserve */
    workerLocation: enabledWorkers[0]?.name ?? 'unknown',
    /* v8 ignore stop @preserve */
    repository: originalTask.repository,
    baseBranch: originalTask.baseBranch,
    traceId: `execution-${originalTask.traceId}`,
    webhookSecret,
    parentTaskId: originalTask.id,
    followUpReason: 'execution_implement' as const,
    agentType: 'execution' as const,
    linearIssueId,
  };

  const createResult = await codeTaskRepo.create(createInput);

  if (!createResult.ok) {
    // Rollback the optimistic lock
    logger.error({ error: createResult.error }, 'Failed to create Execution Agent task, rolling back optimistic lock');
    const lockRollbackResult = await codeTaskRepo.update(originalTask.id, { implementationTaskId: null });
    if (!lockRollbackResult.ok) {
      logger.error(
        { taskId: originalTask.id, error: lockRollbackResult.error },
        'Failed to rollback implementationTaskId after create failure'
      );
    }
    return err({
      code: 'internal_error',
      message: 'Failed to create Execution Agent task',
    });
  }

  const executionTask = createResult.value;

  logger.info(
    { originalTaskId: originalTask.id, executionTaskId: executionTask.id },
    'Execution Agent task created'
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
      'Failed to update Linear issue to In Progress for Execution Agent'
    );
  }

  const webUrl = process.env['INTEXURAOS_WEB_URL'] ?? 'https://intexuraos.cloud';
  const commentBody = `🚀 **Execution Agent implementation started**

**Design task:** [${originalTask.id}](${webUrl}/#/code-tasks/${originalTask.id})
**Implementation task:** [${executionTaskId}](${webUrl}/#/code-tasks/${executionTaskId})`;

  const commentResult = await linearAgentClient.addComment({
    userId,
    issueId: linearIssueId,
    body: commentBody,
  });

  if (!commentResult.ok) {
    logger.warn(
      { linearIssueId, error: commentResult.error },
      'Failed to add Execution Agent start comment to Linear issue'
    );
  }

  // Step 12: Build dispatch request and dispatch
  const webhookUrl = `${deps.serviceUrl}/internal/webhooks/task-complete`;

  const dispatchRequest = {
    taskId: executionTaskId,
    linearIssueId,
    linearIssueLabels: freshLabels,
    hasChildren: hasChildrenForDispatch,
    prompt: executionTask.sanitizedPrompt,
    systemPromptHash: executionTask.systemPromptHash,
    repository: executionTask.repository,
    baseBranch: executionTask.baseBranch,
    workerType: executionTask.workerType,
    webhookUrl,
    /* v8 ignore start -- ts-type: nullish coalescing on webhookSecret which is always set at task creation @preserve */
    webhookSecret: executionTask.webhookSecret ?? '',
    /* v8 ignore stop @preserve */
    traceId: executionTask.traceId,
    workerCredentials,
    /* v8 ignore start -- ts-type: nullish coalescing on narrowed union field @preserve */
    agentType: executionTask.agentType ?? 'execution',
    /* v8 ignore stop @preserve */
    ...(originalTask.result?.branch !== undefined && { planningPrBranch: originalTask.result.branch }),
    ...(originalTask.result?.planning_pr_url !== undefined && { planningPrUrl: originalTask.result.planning_pr_url }),
  };

  const dispatchResult = await taskDispatcher.dispatch(dispatchRequest);

  if (!dispatchResult.ok) {
    const dispatchError = dispatchResult.error;

    // Step 13a: If at_capacity, try to queue instead of failing
    if (dispatchError.code === 'at_capacity') {
      const config = loadConfig();
      const countResult = await codeTaskRepo.countQueued();

      if (!countResult.ok) {
        logger.error({ error: countResult.error }, 'Failed to count queued tasks, treating as queue full');
      }

      const queuedCount = countResult.ok ? countResult.value : config.queue.maxSize + 1;

      if (queuedCount > config.queue.maxSize) {
        // Queue is full — rollback and fail
        logger.warn(
          { taskId: executionTaskId, queuedCount, maxSize: config.queue.maxSize },
          'Task queue full, cannot enqueue execution task'
        );

        const lockRollbackResult = await codeTaskRepo.update(originalTask.id, { implementationTaskId: null });
        if (!lockRollbackResult.ok) {
          logger.error(
            { taskId: originalTask.id, executionTaskId, error: lockRollbackResult.error },
            'Failed to rollback implementationTaskId after queue full'
          );
        }

        const failMarkResult = await codeTaskRepo.update(executionTaskId, {
          status: 'failed',
          error: {
            code: 'queue_full',
            message: 'All workers at capacity and queue is full',
          },
        });
        if (!failMarkResult.ok) {
          logger.error(
            { executionTaskId, error: failMarkResult.error },
            'Failed to mark execution task as failed after queue full'
          );
        }

        return err({
          code: 'queue_full',
          message: 'All workers are at capacity and the queue is full. Please try again later.',
        });
      }

      // Queue has room — task is already in 'queued' status from creation
      const position = queuedCount;
      const estimatedWaitMinutes = position * 5;

      logger.info(
        { taskId: executionTaskId, position, estimatedWaitMinutes },
        'Enqueueing execution task — workers at capacity'
      );

      const queueResult = await codeTaskRepo.update(executionTaskId, {
        queuedAt: new Date(),
      });

      if (!queueResult.ok) {
        logger.error(
          { executionTaskId, error: queueResult.error },
          'Failed to update execution task with queuedAt timestamp'
        );
      }

      const queuedTask = queueResult.ok ? queueResult.value : executionTask;

      // Best-effort WhatsApp notification
      const notifyResult = await whatsappNotifier.notifyTaskQueued(userId, queuedTask, position, estimatedWaitMinutes);
      if (!notifyResult.ok) {
        logger.warn(
          { taskId: executionTaskId, error: notifyResult.error },
          'Failed to send task queued notification'
        );
      }

      return ok({
        codeTaskId: executionTaskId,
        resourceUrl: `/#/code-tasks/${executionTaskId}`,
        workerLocation: 'queued' as WorkerLocation,
        implementationOf: originalTask.id,
      });
    }

    // Step 13b: Non-at_capacity errors — rollback and fail
    logger.error({ taskId: executionTaskId, error: dispatchError }, 'Failed to dispatch Execution Agent task, rolling back');

    // Roll back optimistic lock on planning task
    const lockRollbackResult = await codeTaskRepo.update(originalTask.id, { implementationTaskId: null });
    if (!lockRollbackResult.ok) {
      logger.error(
        { taskId: originalTask.id, executionTaskId, error: lockRollbackResult.error },
        'Failed to rollback implementationTaskId after dispatch failure'
      );
    }

    // Mark Execution Agent task as failed
    const failMarkResult = await codeTaskRepo.update(executionTaskId, {
      status: 'failed',
      error: {
        code: dispatchError.code,
        message: dispatchError.message,
      },
    });
    if (!failMarkResult.ok) {
      logger.error(
        { executionTaskId, error: failMarkResult.error },
        'Failed to mark Execution Agent task as failed after dispatch failure'
      );
    }

    return err({
      code: 'internal_error',
      message: dispatchError.message,
    });
  }

  logger.info(
    { taskId: executionTaskId, workerLocation: dispatchResult.value.workerLocation },
    'Execution Agent task dispatched'
  );

  // Step 14: Generate cancel nonce and send WhatsApp notification
  const cancelNonce = generateCancelNonce();
  const cancelNonceExpiresAt = new Date(Date.now() + CANCEL_NONCE_TTL_MS).toISOString();

  const updateResult = await codeTaskRepo.update(executionTaskId, {
    status: 'dispatched',
    dispatchedAt: new Date(),
    workerLocation: dispatchResult.value.workerLocation,
    cancelNonce,
    cancelNonceExpiresAt,
  });

  if (updateResult.ok) {
    const updatedTask = updateResult.value;
    const notifyResult = await whatsappNotifier.notifyTaskStarted(userId, updatedTask);
    if (!notifyResult.ok) {
      logger.warn(
        { taskId: executionTaskId, error: notifyResult.error },
        'Failed to send task started notification for Execution Agent'
      );
    }
  } else {
    logger.warn({ taskId: executionTaskId, error: updateResult.error }, 'Failed to update Execution Agent task with cancel nonce');
  }

  // Step 15: Return success
  return ok({
    codeTaskId: executionTaskId,
    resourceUrl: `/#/code-tasks/${executionTaskId}`,
    workerLocation: dispatchResult.value.workerLocation,
    implementationOf: originalTask.id,
  });
}
