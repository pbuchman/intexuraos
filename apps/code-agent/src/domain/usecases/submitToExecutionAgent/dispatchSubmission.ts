/**
 * Dispatch phase for the Execution Agent workflow.
 *
 * Takes a prepared submission from prepareSubmission and creates/enqueues a
 * single execution task for the original Linear issue.
 *
 * Best-effort side effects (Linear issue state, Linear comments) happen here —
 * they are isolated behind `.catch(() => undefined)` so they cannot break the
 * primary dispatch flow.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { randomUUID } from 'node:crypto';
import type { CodeTaskRepository } from '../../repositories/codeTaskRepository.js';
import type { LinearAgentClient } from '../../ports/linearAgentClient.js';
import type { TaskEnqueueService } from '../../services/taskEnqueueService.js';
import type { CodeTask } from '../../models/codeTask.js';
import type { WorkerLocation } from '../../models/worker.js';
import { generateWebhookSecret } from '../../utils/secrets.js';
import {
  EXECUTION_AGENT_PROMPT,
  type SubmitToExecutionAgentError,
  type SubmitToExecutionAgentResult,
} from './types.js';
import type { PreparedSubmission } from './prepareSubmission.js';
import { announceInLinear } from './announceInLinear.js';
import { buildCodeTaskUrl } from '../../utils/taskUrls.js';

export interface DispatchSubmissionDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  taskEnqueueService: TaskEnqueueService;
  orchestratorSecret: string;
}

export async function dispatchSubmission(
  deps: DispatchSubmissionDeps,
  prepared: PreparedSubmission,
): Promise<Result<SubmitToExecutionAgentResult, SubmitToExecutionAgentError>> {
  return await dispatchSingle(deps, prepared);
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
  await announceInLinear(
    { logger, linearAgentClient },
    {
      userId,
      issueId: linearIssueId,
      stateFailureMessage: 'Failed to update Linear issue to In Progress for Execution Agent',
      commentFailureMessage: 'Failed to add Execution Agent start comment to Linear issue',
      body: `🚀 **Execution Agent implementation started**

**Design task:** [${planningTask.id}](${buildCodeTaskUrl(planningTask.id)})
**Implementation task:** [${executionTaskId}](${buildCodeTaskUrl(executionTaskId)})`,
    },
  );

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
    resourceUrl: buildCodeTaskUrl(executionTaskId),
    workerLocation: 'queued' as WorkerLocation,
    implementationOf: planningTask.id,
  });
}
