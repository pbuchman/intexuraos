/**
 * Prepare submission phase for the Execution Agent workflow.
 *
 * Gathers context, performs validation, and builds the prepared submission
 * consumed by the dispatch phase. Throws when the request is malformed
 * (missing required fields), otherwise returns a Result so the caller can
 * propagate structured errors without exception handling.
 */

import { err, ok, IntexuraOSError, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';
import type { LinearAgentClient, IssueTreeNode } from '../../ports/linearAgentClient.js';
import type { WorkerSettingsRepository } from '../../ports/workerSettingsRepository.js';
import type { GitHubPRClient } from '../../ports/gitHubPRClient.js';
import type { CodeTask, WorkerType } from '../../models/codeTask.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { hasCodeTaskLabel, hasComplexTaskLabel, hasUnclearLabel, getWorkerTypeFromLabels } from '../../utils/labelUtils.js';
import { resolveDefaultWorkerType } from '../../utils/defaultWorkerTypeResolution.js';
import { mergePlanPr } from '../../utils/mergePlanPr.js';
import { fetchGitHubToken } from '../../utils/gitHubTokenResolver.js';
import type { SubmitToExecutionAgentError, SubmitToExecutionAgentRequest } from './types.js';

export interface PrepareSubmissionDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  workerSettingsRepo: WorkerSettingsRepository;
  gitHubPRClient: GitHubPRClient;
  userServiceClient: UserServiceClient;
}

/**
 * Context block describing a complex-task fan-out target. Only set when
 * the Linear issue carries the `complex-task` label and has at least one
 * qualifying direct child.
 */
export interface PreparedComplexContext {
  /** Linear issue UUID returned by validateIssue — required by fetchDirectChildrenLive. */
  validatedIssueUuid: string;
  /** Live-fetched direct children of the parent issue. */
  directChildren: IssueTreeNode[];
}

/**
 * Everything the dispatch phase needs to enqueue a task or fan-out.
 */
export interface PreparedSubmission {
  planningTask: CodeTask;
  userId: string;
  linearIssueId: string;
  effectiveWorkerType: WorkerType;
  /** Present iff the parent issue has the `complex-task` label. */
  complex?: PreparedComplexContext;
}

function assertRequestFields(request: SubmitToExecutionAgentRequest): void {
  const missing: string[] = [];
  if (typeof request.originalTaskId !== 'string' || request.originalTaskId.length === 0) {
    missing.push('originalTaskId');
  }
  if (typeof request.userId !== 'string' || request.userId.length === 0) {
    missing.push('userId');
  }
  if (missing.length > 0) {
    throw new IntexuraOSError(
      'INVALID_REQUEST',
      `prepareSubmission: missing required field(s): ${missing.join(', ')}`,
    );
  }
}

/**
 * Prepare the execution-agent submission.
 *
 * Steps:
 * 1. Fetch the originally-requested task.
 * 2. Resolve to the planning task (pass-through or via linearIssueId lookup).
 * 3. Ensure the planning task has a linked Linear issue.
 * 4. Guard against duplicate implementation (implementationTaskId / fanOutChildTaskIds).
 * 5. Best-effort check for active tasks on the same Linear issue.
 * 6. Fetch worker settings, require at least one enabled worker.
 * 7. Fetch live Linear labels and validate (unclear / code-task).
 * 8. Merge the plan PR if one was produced by planning.
 * 9. Resolve effective worker type (label > request > user default > 'auto').
 * 10. For complex tasks, fetch live direct children and return in context.
 */
export async function prepareSubmission(
  deps: PrepareSubmissionDeps,
  request: SubmitToExecutionAgentRequest,
): Promise<Result<PreparedSubmission, SubmitToExecutionAgentError>> {
  assertRequestFields(request);

  const { logger, codeTaskRepo, linearAgentClient, workerSettingsRepo, gitHubPRClient, userServiceClient } = deps;
  const { originalTaskId, userId, workerType } = request;

  // Step 1: Fetch original task
  const originalTaskResult = await codeTaskRepo.findByIdForUser(originalTaskId, userId);
  if (!originalTaskResult.ok) {
    logger.warn({ originalTaskId, userId, error: originalTaskResult.error }, 'Original task not found for Execution Agent submission');
    return err({ code: 'task_not_found', message: `Task ${originalTaskId} not found` });
  }

  const requestedTask = originalTaskResult.value;

  // Step 2: Resolve to planning task if needed.
  let planningTask = requestedTask;
  if (requestedTask.status !== 'planned' || requestedTask.agentType !== 'planning') {
    if (requestedTask.linearIssueId === undefined) {
      logger.warn(
        { taskId: requestedTask.id, status: requestedTask.status, agentType: requestedTask.agentType },
        'Attempted to start Execution Agent on non-planning task without linearIssueId',
      );
      return err({ code: 'invalid_status', message: 'Task must be a completed planning task to start implementation' });
    }

    const resolveResult = await codeTaskRepo.findPlannedTaskByLinearIssue(requestedTask.linearIssueId);
    if (!resolveResult.ok) {
      logger.error(
        { taskId: requestedTask.id, linearIssueId: requestedTask.linearIssueId },
        'Failed to resolve planning task via linearIssueId',
      );
      return err({ code: 'invalid_status', message: 'Task must be a completed planning task to start implementation' });
    }
    if (resolveResult.value === null) {
      logger.warn(
        { taskId: requestedTask.id, linearIssueId: requestedTask.linearIssueId },
        'No planning task found for linearIssueId',
      );
      return err({ code: 'invalid_status', message: 'Task must be a completed planning task to start implementation' });
    }
    if (resolveResult.value.userId !== userId) {
      logger.warn(
        {
          taskId: requestedTask.id,
          linearIssueId: requestedTask.linearIssueId,
          requestedByUserId: userId,
          taskOwnedByUserId: resolveResult.value.userId,
        },
        'Security: resolved planning task belongs to different user',
      );
      return err({ code: 'invalid_status', message: 'Task must be a completed planning task to start implementation' });
    }

    logger.info(
      { requestedTaskId: requestedTask.id, resolvedTaskId: resolveResult.value.id, linearIssueId: requestedTask.linearIssueId },
      'Resolved non-planning task to planning task for implementation',
    );
    planningTask = resolveResult.value;
  }

  // Step 3: Validate task has a linked Linear issue
  if (planningTask.linearIssueId === undefined) {
    logger.warn({ taskId: planningTask.id }, 'Cannot start Execution Agent: task has no linked Linear issue');
    return err({ code: 'no_linear_issue', message: 'Cannot implement — this task has no linked Linear issue' });
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
      'Implementation already started for this task',
    );
    return err({ code: 'already_implemented', message: 'Implementation already started', existingTaskId });
  }

  if (planningTask.fanOutChildTaskIds !== undefined && planningTask.fanOutChildTaskIds.length > 0) {
    const existingTaskId = planningTask.fanOutChildTaskIds[0];
    /* v8 ignore start -- upstream: fanOutChildTaskIds.length > 0 guard above guarantees the first child task id exists here @preserve */
    if (existingTaskId === undefined) {
      return err({ code: 'already_implemented', message: 'Implementation already started', existingTaskId: '' });
    }
    /* v8 ignore stop @preserve */
    logger.warn(
      {
        taskId: planningTask.id,
        existingImplementationTaskId: planningTask.implementationTaskId,
        fanOutChildTaskIds: planningTask.fanOutChildTaskIds,
      },
      'Implementation already started for this task',
    );
    return err({ code: 'already_implemented', message: 'Implementation already started', existingTaskId });
  }

  // Step 5: Check for active tasks on same Linear issue (best-effort)
  const activeCheckResult = await codeTaskRepo.hasActiveTaskForLinearIssue(linearIssueId);
  if (!activeCheckResult.ok) {
    logger.error(
      { linearIssueId, error: activeCheckResult.error },
      'Failed to check for active tasks on Linear issue, proceeding with Execution Agent submission',
    );
  } else if (activeCheckResult.value.hasActive) {
    logger.warn(
      { linearIssueId, activeTaskId: activeCheckResult.value.taskId },
      'Cannot start Execution Agent: active task exists for Linear issue',
    );
    return err({ code: 'active_task_exists', message: 'An active task already exists for this Linear issue' });
  }

  // Step 6: Fetch user's worker settings
  const settingsResult = await workerSettingsRepo.getSettings(userId);
  if (!settingsResult.ok) {
    logger.error({ userId, error: settingsResult.error }, 'Failed to fetch worker settings for Execution Agent submission');
    return err({ code: 'internal_error', message: 'Failed to fetch worker settings' });
  }

  const settings = settingsResult.value;
  const enabledWorkers = (settings?.workers ?? []).filter((w) => w.enabled);
  if (enabledWorkers.length === 0) {
    logger.warn({ userId }, 'User has no workers configured for Execution Agent submission');
    return err({ code: 'worker_not_configured', message: 'No workers configured. Configure workers in Settings.' });
  }

  // Step 7: Fetch fresh labels from Linear and validate
  const validateResult = await linearAgentClient.validateIssue({ userId, identifier: linearIssueId });
  if (!validateResult.ok) {
    logger.warn({ linearIssueId, error: validateResult.error }, 'Failed to fetch Linear issue labels for Execution Agent submission');
    return err({ code: 'label_not_ready', message: 'Failed to fetch Linear issue labels. Please try again.' });
  }

  const freshLabels = validateResult.value.labels;
  const isComplexTask = hasComplexTaskLabel(freshLabels);

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

  // Step 8: Merge plan PR if planning task produced one.
  // planning_pr_url is the canonical field; fall back to prUrl for planning tasks
  // where result merging failed and the field was stored under the generic key.
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

  // Step 9: Resolve effective worker type — label > request > user setting > 'auto'.
  const workerResolution = resolveDefaultWorkerType({
    agentType: 'execution',
    labelWorkerType: getWorkerTypeFromLabels(freshLabels),
    requestWorkerType: workerType,
    settings,
  });
  const effectiveWorkerType = workerResolution.workerType;
  if (workerResolution.source === 'default' && workerResolution.defaultField !== undefined) {
    logger.info({ userId, [workerResolution.defaultField]: effectiveWorkerType }, 'Using user default worker type');
  }

  // Step 10: For complex tasks, fetch live direct children now — the dispatcher
  // needs them to fan out.
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
      return err({ code: 'internal_error', message: 'Failed to fetch child issues for complex implementation' });
    }

    const directChildren = directChildrenResult.value.filter((child) => child.parentId === validateResult.value.id);
    if (directChildren.length === 0) {
      logger.warn({ linearIssueId, issueId: validateResult.value.id }, 'Complex task has no live direct children');
      return err({
        code: 'complex_task_no_qualifying_children',
        message: 'Complex task has no direct child issues with code-task label',
      });
    }

    return ok({
      planningTask,
      userId,
      linearIssueId,
      effectiveWorkerType,
      complex: { validatedIssueUuid: validateResult.value.id, directChildren },
    });
  }

  return ok({ planningTask, userId, linearIssueId, effectiveWorkerType });
}
