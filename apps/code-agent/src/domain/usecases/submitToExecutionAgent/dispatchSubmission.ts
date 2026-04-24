/**
 * Dispatch phase for the Execution Agent workflow.
 *
 * Takes a prepared submission from prepareSubmission and either:
 *   - fans out child tasks for complex parents, or
 *   - creates and enqueues a single execution task.
 *
 * Best-effort side effects (Linear issue state, Linear comments) happen here —
 * they are isolated behind `.catch(() => undefined)` so they cannot break the
 * primary dispatch flow.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { randomUUID } from 'node:crypto';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';
import type { LinearAgentClient, IssueTreeNode } from '../../ports/linearAgentClient.js';
import type { TaskEnqueueService } from '../../services/taskEnqueueService.js';
import type { CodeTask } from '../../models/codeTask.js';
import type { WorkerLocation } from '../../models/worker.js';
import { hasCodeTaskLabel } from '../../utils/labelUtils.js';
import { generateWebhookSecret } from '../../utils/secrets.js';
import { fanOutChildTasks } from '../fanOutChildTasks.js';
import {
  EXECUTION_AGENT_PROMPT,
  type SubmitToExecutionAgentError,
  type SubmitToExecutionAgentResult,
} from './types.js';
import type { PreparedSubmission } from './prepareSubmission.js';

export interface DispatchSubmissionDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  taskEnqueueService: TaskEnqueueService;
  orchestratorSecret: string;
}

/**
 * Dispatch a prepared submission: either fan out to children for a complex
 * parent, or create + enqueue a single execution task.
 */
export async function dispatchSubmission(
  deps: DispatchSubmissionDeps,
  prepared: PreparedSubmission,
): Promise<Result<SubmitToExecutionAgentResult, SubmitToExecutionAgentError>> {
  if (prepared.complex !== undefined) {
    return await dispatchComplex(deps, prepared, prepared.complex.validatedIssueUuid, prepared.complex.directChildren);
  }
  return await dispatchSingle(deps, prepared);
}

async function dispatchComplex(
  deps: DispatchSubmissionDeps,
  prepared: PreparedSubmission,
  validatedIssueUuid: string,
  directChildren: IssueTreeNode[],
): Promise<Result<SubmitToExecutionAgentResult, SubmitToExecutionAgentError>> {
  const { logger, codeTaskRepo, linearAgentClient, taskEnqueueService, orchestratorSecret } = deps;
  const { planningTask, userId, linearIssueId, effectiveWorkerType } = prepared;

  logger.info(
    { linearIssueId, issueId: validatedIssueUuid, childIdentifiers: directChildren.map((child) => child.identifier) },
    'Complex task detected, triggering live child fan-out',
  );

  const fanOutResult = await fanOutChildTasks(
    { logger, codeTaskRepo, taskEnqueueService, orchestratorSecret },
    { planningTask, userId, childIssues: directChildren, workerType: effectiveWorkerType },
  );

  if (!fanOutResult.ok) {
    if (fanOutResult.error.code === 'no_qualifying_children') {
      return err({ code: 'complex_task_no_qualifying_children', message: fanOutResult.error.message });
    }
    if (fanOutResult.error.code === 'queue_full') {
      return err({ code: 'queue_full', message: fanOutResult.error.message });
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

  const childTaskLines = qualifyingChildren
    .map((child, index) => {
      const taskId = fanOutResult.value.childTaskIds[index];
      return taskId !== undefined
        ? `- ${child.identifier}: [${taskId}](${webUrl}/#/code-tasks/${taskId})`
        : `- ${child.identifier}`;
    })
    .join('\n');

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
      await linearAgentClient
        .updateIssueState({ userId, issueId: child.identifier, state: 'in_progress' })
        .catch(() => undefined);
      const childTaskId = fanOutResult.value.childTaskIds[index];
      if (childTaskId === undefined) {
        return;
      }
      await linearAgentClient
        .addComment({
          userId,
          issueId: child.identifier,
          body: `🚀 **Execution Agent implementation started**

**Design task:** [${planningTask.id}](${webUrl}/#/code-tasks/${planningTask.id})
**Implementation task:** [${childTaskId}](${webUrl}/#/code-tasks/${childTaskId})`,
        })
        .catch(() => undefined);
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

async function dispatchSingle(
  deps: DispatchSubmissionDeps,
  prepared: PreparedSubmission,
): Promise<Result<SubmitToExecutionAgentResult, SubmitToExecutionAgentError>> {
  const { logger, codeTaskRepo, linearAgentClient, taskEnqueueService, orchestratorSecret } = deps;
  const { planningTask, userId, linearIssueId, effectiveWorkerType } = prepared;

  // Optimistic lock: set implementationTaskId on planning task BEFORE dispatch.
  const executionTaskId = `task_${randomUUID()}`;

  const lockResult = await codeTaskRepo.update(planningTask.id, { implementationTaskId: executionTaskId });
  if (!lockResult.ok) {
    logger.error({ taskId: planningTask.id, error: lockResult.error }, 'Failed to set optimistic lock for Execution Agent implementation');
    return err({ code: 'internal_error', message: 'Failed to start implementation' });
  }

  // Create the Execution Agent task
  const webhookSecret = generateWebhookSecret(orchestratorSecret, executionTaskId);
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
    logger.error({ error: createResult.error }, 'Failed to create Execution Agent task, rolling back optimistic lock');
    const lockRollbackResult = await codeTaskRepo.update(planningTask.id, { implementationTaskId: null });
    if (!lockRollbackResult.ok) {
      logger.error(
        { taskId: planningTask.id, error: lockRollbackResult.error },
        'Failed to rollback implementationTaskId after create failure',
      );
    }
    return err({ code: 'internal_error', message: 'Failed to create Execution Agent task' });
  }

  const executionTask: CodeTask = createResult.value;
  logger.info(
    { originalTaskId: planningTask.id, executionTaskId: executionTask.id },
    'Execution Agent task created',
  );

  // Update Linear issue to In Progress + add comment (best-effort)
  const updateIssueResult = await linearAgentClient.updateIssueState({
    userId,
    issueId: linearIssueId,
    state: 'in_progress',
  });
  if (!updateIssueResult.ok) {
    logger.warn({ linearIssueId, error: updateIssueResult.error }, 'Failed to update Linear issue to In Progress for Execution Agent');
  }

  const webUrl = process.env['INTEXURAOS_WEB_URL'] ?? 'https://intexuraos.cloud';
  const commentBody = `🚀 **Execution Agent implementation started**

**Design task:** [${planningTask.id}](${webUrl}/#/code-tasks/${planningTask.id})
**Implementation task:** [${executionTaskId}](${webUrl}/#/code-tasks/${executionTaskId})`;

  const commentResult = await linearAgentClient.addComment({ userId, issueId: linearIssueId, body: commentBody });
  if (!commentResult.ok) {
    logger.warn({ linearIssueId, error: commentResult.error }, 'Failed to add Execution Agent start comment to Linear issue');
  }

  // Enqueue the task for the worker
  const enqueueResult = await taskEnqueueService.enqueue({ taskId: executionTaskId, userId });
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
    'Execution Agent task enqueued',
  );

  return ok({
    codeTaskId: executionTaskId,
    resourceUrl: `/#/code-tasks/${executionTaskId}`,
    workerLocation: 'queued' as WorkerLocation,
    implementationOf: planningTask.id,
  });
}
