/**
 * Use case: Fan out child code tasks from a parent issue.
 *
 * When a parent Linear issue has children with `code-task` labels,
 * creates separate code tasks for each child and queues them for dispatch.
 * The parent task is marked as `implemented` (fan-out completed) without
 * being dispatched to a worker.
 *
 * INT-962: Auto fan-out for parent issues with code-task children.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { randomUUID } from 'node:crypto';
import type { CodeTask } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { LinearAgentClient, IssueTreeNode } from '../ports/linearAgentClient.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import { hasCodeTaskLabel } from '../utils/labelUtils.js';
import { generateWebhookSecret } from '../utils/secrets.js';

export interface FanOutChildTasksDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  linearAgentClient: LinearAgentClient;
  taskEnqueueService: TaskEnqueueService;
  orchestratorSecret: string;
}

export interface FanOutChildTasksRequest {
  parentTask: CodeTask;
  userId: string;
  linearIssueId: string;
  /** Pre-resolved UUID from a prior validateIssue call, avoids redundant API call. */
  parentIssueUuid?: string;
}

export interface FanOutChildTasksResult {
  childTaskIds: string[];
  parentTaskId: string;
}

export type FanOutChildTasksErrorCode =
  | 'no_qualifying_children'
  | 'linear_unavailable'
  | 'internal_error';

export interface FanOutChildTasksError {
  code: FanOutChildTasksErrorCode;
  message: string;
}

/**
 * Determine if fan-out should be attempted for this task.
 *
 * Conditions: the issue has children AND has the `code-task` label.
 * If false, the caller should proceed with normal dispatch.
 */
export function shouldFanOut(hasChildren: boolean, linearIssueLabels: string[]): boolean {
  return hasChildren && hasCodeTaskLabel(linearIssueLabels);
}

/**
 * Create a single child task and enqueue it (best-effort enqueue).
 * Returns the child task ID on success, or null on failure.
 */
async function createAndEnqueueChild(
  deps: Pick<FanOutChildTasksDeps, 'codeTaskRepo' | 'taskEnqueueService' | 'logger' | 'orchestratorSecret'>,
  parentTask: CodeTask,
  child: IssueTreeNode,
  userId: string,
): Promise<string | null> {
  const { codeTaskRepo, taskEnqueueService, logger } = deps;
  const childTaskId = `task_${randomUUID()}`;
  const webhookSecret = generateWebhookSecret(deps.orchestratorSecret, childTaskId);

  const createResult = await codeTaskRepo.create({
    id: childTaskId,
    userId,
    // prompt stores a descriptive summary; sanitizedPrompt is the child identifier
    // sent to the worker (the worker reads the Linear issue for full instructions)
    prompt: `[Fan-out from ${parentTask.linearIssueId ?? 'parent'}] ${child.identifier}`,
    sanitizedPrompt: child.identifier,
    webhookSecret,
    systemPromptHash: parentTask.systemPromptHash,
    workerType: parentTask.workerType,
    workerLocation: parentTask.workerLocation,
    repository: parentTask.repository,
    baseBranch: parentTask.baseBranch,
    traceId: `trace-fanout-${String(Date.now())}-${child.identifier}`,
    actionId: `fanout_${randomUUID()}`,
    approvalEventId: `fanout_approval_${randomUUID()}`,
    linearIssueId: child.identifier,
    agentType: 'execution',
    initialStatus: 'queued',
  });

  if (!createResult.ok) {
    logger.warn(
      { childIdentifier: child.identifier, error: createResult.error },
      'Fan-out: failed to create child task, skipping',
    );
    return null;
  }

  // Best-effort enqueue — if it fails, the task is still in 'queued' status
  // and can be picked up by drainTaskQueue
  const enqueueResult = await taskEnqueueService.enqueue({ taskId: childTaskId, userId });
  if (!enqueueResult.ok) {
    logger.warn(
      { childTaskId, error: enqueueResult.error },
      'Fan-out: failed to enqueue child task (task remains queued)',
    );
  }

  logger.info({ childTaskId, childIdentifier: child.identifier }, 'Fan-out: child task created and enqueued');
  return childTaskId;
}

export async function fanOutChildTasks(
  deps: FanOutChildTasksDeps,
  request: FanOutChildTasksRequest,
): Promise<Result<FanOutChildTasksResult, FanOutChildTasksError>> {
  const { logger, codeTaskRepo, linearAgentClient } = deps;
  const { parentTask, userId, linearIssueId } = request;

  // Step 1: Resolve parent UUID — reuse caller-provided UUID to avoid redundant API call
  let parentUuid = request.parentIssueUuid;

  if (parentUuid === undefined) {
    const validateResult = await linearAgentClient.validateIssue({
      userId,
      identifier: linearIssueId,
    });

    if (!validateResult.ok) {
      logger.warn({ linearIssueId, error: validateResult.error }, 'Fan-out: failed to validate parent issue');
      return err({ code: 'linear_unavailable', message: validateResult.error.message });
    }

    parentUuid = validateResult.value.id;
  }

  // Step 2: Fetch issue tree
  const treeResult = await linearAgentClient.fetchIssueTree({
    userId,
    issueId: parentUuid,
  });

  if (!treeResult.ok) {
    logger.warn({ linearIssueId, error: treeResult.error }, 'Fan-out: failed to fetch issue tree');
    return err({ code: 'linear_unavailable', message: treeResult.error.message });
  }

  // Step 3: Filter direct children with code-task label
  const qualifyingChildren = treeResult.value.descendants.filter(
    (node: IssueTreeNode) => node.parentId === parentUuid && hasCodeTaskLabel(node.labels),
  );

  if (qualifyingChildren.length === 0) {
    logger.info({ linearIssueId, descendantCount: treeResult.value.descendants.length }, 'Fan-out: no qualifying children with code-task label');
    return err({ code: 'no_qualifying_children', message: 'No direct children with code-task label found' });
  }

  logger.info(
    { linearIssueId, qualifyingChildCount: qualifyingChildren.length },
    'Fan-out: creating child tasks',
  );

  // Step 4: Create child tasks concurrently.
  // createAndEnqueueChild catches all errors internally and returns null on failure,
  // so Promise.all is safe here (no rejections possible).
  const results = await Promise.all(
    qualifyingChildren.map((child) => createAndEnqueueChild(deps, parentTask, child, userId)),
  );

  const childTaskIds = results.filter((id): id is string => id !== null);

  if (childTaskIds.length === 0) {
    return err({ code: 'internal_error', message: 'All child task creations failed' });
  }

  // Step 5: Mark the parent task as implemented (fan-out completed)
  const updateResult = await codeTaskRepo.update(parentTask.id, {
    status: 'implemented',
    completedAt: new Date(),
    result: {
      summary: `Fan-out completed: created ${String(childTaskIds.length)} child task(s) from ${String(qualifyingChildren.length)} qualifying children. Child tasks: ${childTaskIds.join(', ')}`,
      execution_outcome_label: 'implemented',
    },
  });

  if (!updateResult.ok) {
    logger.warn(
      { parentTaskId: parentTask.id, error: updateResult.error },
      'Fan-out: failed to mark parent task as implemented',
    );
  }

  return ok({
    childTaskIds,
    parentTaskId: parentTask.id,
  });
}
