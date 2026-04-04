/**
 * Use case: Start Execution Agent implementation from a completed planning design task.
 *
 * Validates that the Linear issue has either:
 * - 'code-task' label → dispatches a single Execution Agent task
 * - 'complex-task' label → fans out child tasks via fanOutChildTasks
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import type { MetricsClient } from '../../domain/services/metrics.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerType } from '../../domain/models/codeTask.js';
import type { WorkerLocation } from '../../domain/models/worker.js';
import { hasCodeTaskLabel, hasComplexTaskLabel, hasUnclearLabel, getWorkerTypeFromLabels } from '../../domain/utils/labelUtils.js';
import { randomUUID } from 'node:crypto';
import { generateWebhookSecret } from '../utils/secrets.js';
import { fanOutChildTasks } from './fanOutChildTasks.js';
import type { GitHubPRClient } from '../ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { mergePlanPr } from '../utils/mergePlanPr.js';
import { fetchGitHubToken } from '../utils/gitHubTokenResolver.js';

export const EXECUTION_AGENT_PROMPT =
  'Implement the requirements defined in the linked Linear issue and its comments (newest first). Follow the test plan, write code, run CI, and create a PR.';

/**
 * Request to start Execution Agent implementation.
 */
export interface SubmitToExecutionAgentRequest {
  /** The ID of any task in the issue group. If not a planning task, the planning task is resolved automatically via linearIssueId. */
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
  /** Child task IDs created by fan-out for complex tasks */
  childTaskIds?: string[];
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
  | 'complex_task_no_qualifying_children'
  | 'label_not_ready'
  | 'worker_not_configured'
  | 'queue_full'
  | 'plan_pr_merge_failed'
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
  taskEnqueueService: TaskEnqueueService;
  metricsClient: MetricsClient;
  workerSettingsRepo: WorkerSettingsRepository;
  orchestratorSecret: string;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
}

/**
 * Submit to Execution Agent use case.
 *
 * Workflow:
 * 1. Fetch requested task and validate it belongs to user
 * 2. Resolve to planning task (pass-through if already planning, otherwise look up via linearIssueId)
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
  const { logger, codeTaskRepo, linearAgentClient, taskEnqueueService, workerSettingsRepo, gitHubPRClient, userServiceClient } = deps;
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

  const requestedTask = originalTaskResult.value;

  // Step 2: Resolve to planning task if needed.
  // Users often click /implement from whichever task they're viewing (review, remediation),
  // not necessarily the planning task. Resolve via linearIssueId so any group member works.
  let planningTask = requestedTask;
  if (requestedTask.status !== 'planned' || requestedTask.agentType !== 'planning') {
    if (requestedTask.linearIssueId === undefined) {
      logger.warn(
        { taskId: requestedTask.id, status: requestedTask.status, agentType: requestedTask.agentType },
        'Attempted to start Execution Agent on non-planning task without linearIssueId'
      );
      return err({
        code: 'invalid_status',
        message: 'Task must be a completed planning task to start implementation',
      });
    }

    const resolveResult = await codeTaskRepo.findPlannedTaskByLinearIssue(requestedTask.linearIssueId);
    if (!resolveResult.ok) {
      logger.error(
        { taskId: requestedTask.id, linearIssueId: requestedTask.linearIssueId },
        'Failed to resolve planning task via linearIssueId'
      );
      return err({
        code: 'invalid_status',
        message: 'Task must be a completed planning task to start implementation',
      });
    }
    if (resolveResult.value === null) {
      logger.warn(
        { taskId: requestedTask.id, linearIssueId: requestedTask.linearIssueId },
        'No planning task found for linearIssueId'
      );
      return err({
        code: 'invalid_status',
        message: 'Task must be a completed planning task to start implementation',
      });
    }
    if (resolveResult.value.userId !== userId) {
      logger.warn(
        { taskId: requestedTask.id, linearIssueId: requestedTask.linearIssueId, requestedByUserId: userId, taskOwnedByUserId: resolveResult.value.userId },
        'Security: resolved planning task belongs to different user'
      );
      return err({
        code: 'invalid_status',
        message: 'Task must be a completed planning task to start implementation',
      });
    }

    logger.info(
      { requestedTaskId: requestedTask.id, resolvedTaskId: resolveResult.value.id, linearIssueId: requestedTask.linearIssueId },
      'Resolved non-planning task to planning task for implementation'
    );
    planningTask = resolveResult.value;
  }

  // Step 3: Validate task has a linked Linear issue
  if (planningTask.linearIssueId === undefined) {
    logger.warn({ taskId: planningTask.id }, 'Cannot start Execution Agent: task has no linked Linear issue');
    return err({
      code: 'no_linear_issue',
      message: 'Cannot implement — this task has no linked Linear issue',
    });
  }

  const linearIssueId = planningTask.linearIssueId;

  // Step 4: Guard against duplicate implementation
  if (planningTask.implementationTaskId !== undefined) {
    const existingTaskId = planningTask.implementationTaskId;
    logger.warn(
      {
        taskId: planningTask.id,
        existingImplementationTaskId: planningTask.implementationTaskId,
        fanOutChildTaskIds: planningTask.fanOutChildTaskIds,
      },
      'Implementation already started for this task'
    );
    return err({
      code: 'already_implemented',
      message: 'Implementation already started',
      existingTaskId,
    });
  }

  if (planningTask.fanOutChildTaskIds !== undefined && planningTask.fanOutChildTaskIds.length > 0) {
    const existingTaskId = planningTask.fanOutChildTaskIds[0];
    /* v8 ignore start -- upstream: fanOutChildTaskIds.length > 0 guard above guarantees the first child task id exists here @preserve */
    if (existingTaskId === undefined) {
      return err({
        code: 'already_implemented',
        message: 'Implementation already started',
        existingTaskId: '',
      });
    }
    /* v8 ignore stop @preserve */
    logger.warn(
      {
        taskId: planningTask.id,
        existingImplementationTaskId: planningTask.implementationTaskId,
        fanOutChildTaskIds: planningTask.fanOutChildTaskIds,
      },
      'Implementation already started for this task'
    );
    return err({
      code: 'already_implemented',
      message: 'Implementation already started',
      existingTaskId,
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
  const isComplexTask = hasComplexTaskLabel(freshLabels);

  // Step 8: Check labels
  if (hasUnclearLabel(freshLabels)) {
    logger.warn({ linearIssueId, labels: freshLabels }, 'Linear issue has unclear label, cannot proceed to Execution Agent');
    return err({
      code: 'label_not_ready',
      message: 'The planning agent flagged questions that need resolution. Review the Linear issue, address open questions, then retry the planning agent.',
    });
  } else if (!isComplexTask && !hasCodeTaskLabel(freshLabels)) {
    logger.warn({ linearIssueId, labels: freshLabels }, 'Linear issue missing code-task label, planning may not have completed successfully');
    return err({
      code: 'label_not_ready',
      message: "The code-task label hasn't been added yet. The planning agent may not have completed successfully.",
    });
  }

  // Step 8b: Merge plan PR if planning task produced one
  const planningPrUrl = planningTask.result?.planning_pr_url ?? planningTask.result?.prUrl;
  if (planningPrUrl !== undefined) {
    const gitHubToken = await fetchGitHubToken(userServiceClient, userId, logger);
    if (gitHubToken === null) {
      logger.warn({ userId }, 'Cannot merge plan PR: GitHub OAuth token unavailable');
      return err({
        code: 'plan_pr_merge_failed',
        message: 'GitHub OAuth token is required to merge the plan PR. Please reconnect your GitHub account.',
      });
    }

    const mergeResult = await mergePlanPr(
      { logger, gitHubPRClient },
      { planningPrUrl, repository: planningTask.repository, token: gitHubToken },
    );

    if (!mergeResult.ok) {
      logger.warn({ planningPrUrl, error: mergeResult.error }, 'Plan PR merge failed — cannot proceed with implementation');
      return err(mergeResult.error);
    }

    logger.info({ planningPrUrl }, 'Plan PR merged into development — proceeding with execution task creation');
  }

  // Resolution chain: Linear label > explicit request > user setting > 'auto'
  const labelWorkerType = getWorkerTypeFromLabels(freshLabels);
  let effectiveWorkerType: WorkerType = labelWorkerType ?? workerType ?? 'auto';
  if (effectiveWorkerType === 'auto') {
    if (settings?.defaultExecutionWorkerType !== undefined) {
      effectiveWorkerType = settings.defaultExecutionWorkerType;
      logger.info({ userId, defaultExecutionWorkerType: effectiveWorkerType }, 'Using user default execution worker type');
    }
  }

  if (isComplexTask) {
    const directChildrenResult = await linearAgentClient.fetchDirectChildrenLive({
      userId,
      issueId: validateResult.value.id,
    });

    if (!directChildrenResult.ok) {
      logger.error(
        { linearIssueId, issueId: validateResult.value.id, error: directChildrenResult.error },
        'Failed to fetch live direct children for complex task',
      );
      return err({
        code: 'internal_error',
        message: 'Failed to fetch child issues for complex implementation',
      });
    }

    const directChildren = directChildrenResult.value.filter((child) => child.parentId === validateResult.value.id);
    if (directChildren.length === 0) {
      logger.warn({ linearIssueId, issueId: validateResult.value.id }, 'Complex task has no live direct children');
      return err({
        code: 'complex_task_no_qualifying_children',
        message: 'Complex task has no direct child issues with code-task label',
      });
    }

    logger.info(
      { linearIssueId, issueId: validateResult.value.id, childIdentifiers: directChildren.map((child) => child.identifier) },
      'Complex task detected, triggering live child fan-out',
    );

    const fanOutResult = await fanOutChildTasks(
      { logger, codeTaskRepo, taskEnqueueService, orchestratorSecret: deps.orchestratorSecret },
      {
        planningTask,
        userId,
        childIssues: directChildren,
        workerType: effectiveWorkerType,
      },
    );

    if (!fanOutResult.ok) {
      if (fanOutResult.error.code === 'no_qualifying_children') {
        return err({
          code: 'complex_task_no_qualifying_children',
          message: fanOutResult.error.message,
        });
      }
      if (fanOutResult.error.code === 'queue_full') {
        return err({
          code: 'queue_full',
          message: fanOutResult.error.message,
        });
      }
      logger.error({ linearIssueId, error: fanOutResult.error }, 'Complex task fan-out failed');
      return err({ code: 'internal_error', message: `Fan-out failed: ${fanOutResult.error.message}` });
    }

    const webUrl = process.env['INTEXURAOS_WEB_URL'] ?? 'https://intexuraos.cloud';
    const qualifyingChildren = directChildren
      .filter((child) => hasCodeTaskLabel(child.labels))
      .sort((a, b) => a.identifier.localeCompare(b.identifier));

    const updateParentIssueResult = await linearAgentClient.updateIssueState({
      userId,
      issueId: linearIssueId,
      state: 'in_progress',
    });
    if (!updateParentIssueResult.ok) {
      logger.warn(
        { linearIssueId, error: updateParentIssueResult.error },
        'Failed to update parent Linear issue to In Progress for complex execution',
      );
    }

    const childTaskLines = qualifyingChildren.map((child, index) => {
      const taskId = fanOutResult.value.childTaskIds[index];
      return taskId !== undefined
        ? `- ${child.identifier}: [${taskId}](${webUrl}/#/code-tasks/${taskId})`
        : `- ${child.identifier}`;
    }).join('\n');

    const parentCommentResult = await linearAgentClient.addComment({
      userId,
      issueId: linearIssueId,
      body: `🚀 **Execution Agent implementation started for child tasks**

**Design task:** [${planningTask.id}](${webUrl}/#/code-tasks/${planningTask.id})
**Child implementation tasks:**
${childTaskLines}`,
    });
    if (!parentCommentResult.ok) {
      logger.warn(
        { linearIssueId, error: parentCommentResult.error },
        'Failed to add complex Execution Agent start comment to parent Linear issue',
      );
    }

    await Promise.all(
      qualifyingChildren.map(async (child, index) => {
        await linearAgentClient.updateIssueState({
          userId,
          issueId: child.identifier,
          state: 'in_progress',
        }).catch(() => undefined);
        const childTaskId = fanOutResult.value.childTaskIds[index];
        if (childTaskId === undefined) {
          return;
        }
        await linearAgentClient.addComment({
          userId,
          issueId: child.identifier,
          body: `🚀 **Execution Agent implementation started**

**Design task:** [${planningTask.id}](${webUrl}/#/code-tasks/${planningTask.id})
**Implementation task:** [${childTaskId}](${webUrl}/#/code-tasks/${childTaskId})`,
        }).catch(() => undefined);
      }),
    );

    return ok({
      codeTaskId: fanOutResult.value.primaryChildTaskId,
      resourceUrl: `/#/code-tasks/${fanOutResult.value.primaryChildTaskId}`,
      workerLocation: 'queued' as WorkerLocation,
      implementationOf: planningTask.id,
      childTaskIds: fanOutResult.value.childTaskIds,
    });
  }

  // Step 9: SET implementationTaskId on planning task BEFORE dispatch (optimistic lock)
  const executionTaskId = `task_${randomUUID()}`;

  const lockResult = await codeTaskRepo.update(planningTask.id, {
    implementationTaskId: executionTaskId,
  });

  if (!lockResult.ok) {
    logger.error({ taskId: planningTask.id, error: lockResult.error }, 'Failed to set optimistic lock for Execution Agent implementation');
    return err({
      code: 'internal_error',
      message: 'Failed to start implementation',
    });
  }

  // Step 10: Create the Execution Agent task
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, executionTaskId);
  const createInput = {
    id: executionTaskId,
    userId,
    prompt: EXECUTION_AGENT_PROMPT,
    sanitizedPrompt: EXECUTION_AGENT_PROMPT,
    systemPromptHash: planningTask.systemPromptHash,
    workerType: effectiveWorkerType,
    workerLocation: 'queued' as const,
    repository: planningTask.repository,
    baseBranch: planningTask.baseBranch,
    traceId: `execution-${planningTask.traceId}`,
    webhookSecret,
    parentTaskId: planningTask.id,
    followUpReason: 'execution_implement' as const,
    agentType: 'execution' as const,
    linearIssueId,
  };

  const createResult = await codeTaskRepo.create(createInput);

  if (!createResult.ok) {
    // Rollback the optimistic lock
    logger.error({ error: createResult.error }, 'Failed to create Execution Agent task, rolling back optimistic lock');
    const lockRollbackResult = await codeTaskRepo.update(planningTask.id, { implementationTaskId: null });
    if (!lockRollbackResult.ok) {
      logger.error(
        { taskId: planningTask.id, error: lockRollbackResult.error },
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
    { originalTaskId: planningTask.id, executionTaskId: executionTask.id },
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

**Design task:** [${planningTask.id}](${webUrl}/#/code-tasks/${planningTask.id})
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

  // Step 12: Normal enqueue for single tasks
  const enqueueResult = await taskEnqueueService.enqueue({
    taskId: executionTaskId,
    userId,
  });

  if (!enqueueResult.ok) {
    // Rollback implementationTaskId on planning task
    await codeTaskRepo.update(planningTask.id, { implementationTaskId: null });
    if (enqueueResult.error.code === 'queue_full') {
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    return err({ code: 'internal_error', message: enqueueResult.error.message });
  }

  logger.info(
    { taskId: executionTaskId, queuePosition: enqueueResult.value.queuePosition },
    'Execution Agent task enqueued'
  );

  // Step 13: Return success
  return ok({
    codeTaskId: executionTaskId,
    resourceUrl: `/#/code-tasks/${executionTaskId}`,
    workerLocation: 'queued' as WorkerLocation,
    implementationOf: planningTask.id,
  });
}
