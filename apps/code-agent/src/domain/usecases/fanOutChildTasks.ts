/**
 * Use case: create and enqueue execution child tasks for a complex parent issue.
 *
 * Child discovery happens before this use case using live Linear data. This helper
 * only filters qualifying children, persists child execution tasks, links them back
 * to the planning task, and enqueues them as a batch.
 */

import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { randomUUID } from 'node:crypto';
import type { CodeTask, WorkerType } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { IssueTreeNode } from '../ports/linearAgentClient.js';
import type { TaskEnqueueService } from '../services/taskEnqueueService.js';
import { hasCodeTaskLabel } from '../utils/labelUtils.js';
import { generateWebhookSecret } from '../utils/secrets.js';

export interface FanOutChildTasksDeps {
  logger: Logger;
  codeTaskRepo: CodeTaskRepository;
  taskEnqueueService: TaskEnqueueService;
  orchestratorSecret: string;
}

export interface FanOutChildTasksRequest {
  planningTask: CodeTask;
  userId: string;
  childIssues: IssueTreeNode[];
  workerType: WorkerType;
}

export interface FanOutChildTasksResult {
  childTaskIds: string[];
  primaryChildTaskId: string;
  primaryChildIssueId: string;
}

export type FanOutChildTasksErrorCode =
  | 'no_qualifying_children'
  | 'queue_full'
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

interface PreparedChildTask {
  child: IssueTreeNode;
  taskId: string;
}

function getQualifyingChildren(childIssues: IssueTreeNode[]): IssueTreeNode[] {
  return childIssues
    .filter((child) => hasCodeTaskLabel(child.labels))
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
}

function buildPreparedChildren(childIssues: IssueTreeNode[]): PreparedChildTask[] {
  return childIssues.map((child) => ({
    child,
    taskId: `task_${randomUUID()}`,
  }));
}

function getFanOutParentDescriptor(planningTask: CodeTask): string {
  return planningTask.linearIssueId ?? planningTask.id;
}

async function persistBatchTransactional(
  deps: FanOutChildTasksDeps,
  request: FanOutChildTasksRequest,
  preparedChildren: PreparedChildTask[],
  primaryChildTaskId: string,
): Promise<Result<void, FanOutChildTasksError>> {
  const { codeTaskRepo } = deps;
  const { planningTask, userId, workerType } = request;
  const childTaskIds = preparedChildren.map(({ taskId }) => taskId);
  const parentDescriptor = getFanOutParentDescriptor(planningTask);

  // Link children to the planning task first.
  // Sequential create calls follow — each runs its own internal dedup transaction,
  // which correctly orders reads before writes (unlike a shared outer transaction
  // that would violate Firestore's read-before-write constraint).
  const lockResult = await codeTaskRepo.update(planningTask.id, {
    implementationTaskId: primaryChildTaskId,
    fanOutChildTaskIds: childTaskIds,
  });
  if (!lockResult.ok) {
    return err({ code: 'internal_error', message: 'Failed to link complex child tasks to planning task' });
  }

  const createdTaskIds: string[] = [];
  for (const prepared of preparedChildren) {
    const createResult = await codeTaskRepo.create({
      id: prepared.taskId,
      userId,
      prompt: `[Fan-out from ${parentDescriptor}] ${prepared.child.identifier}`,
      sanitizedPrompt: prepared.child.identifier,
      webhookSecret: generateWebhookSecret(deps.orchestratorSecret, prepared.taskId),
      systemPromptHash: planningTask.systemPromptHash,
      workerType,
      workerLocation: 'queued',
      repository: planningTask.repository,
      baseBranch: planningTask.baseBranch,
      traceId: `execution-${planningTask.traceId}-${prepared.child.identifier}`,
      approvalEventId: `fanout_approval_${randomUUID()}`,
      linearIssueId: prepared.child.identifier,
      parentTaskId: planningTask.id,
      followUpReason: 'execution_implement',
      agentType: 'execution',
      initialStatus: 'queued',
    });
    if (!createResult.ok) {
      for (const createdTaskId of createdTaskIds) {
        await codeTaskRepo.deleteTask(createdTaskId, userId);
      }
      await codeTaskRepo.update(planningTask.id, {
        implementationTaskId: null,
        fanOutChildTaskIds: null,
      });
      return err({
        code: 'internal_error',
        message: `Failed to create child execution task for ${prepared.child.identifier}`,
      });
    }
    createdTaskIds.push(prepared.taskId);
  }

  return ok(undefined);
}

export async function fanOutChildTasks(
  deps: FanOutChildTasksDeps,
  request: FanOutChildTasksRequest,
): Promise<Result<FanOutChildTasksResult, FanOutChildTasksError>> {
  const { logger, codeTaskRepo, taskEnqueueService } = deps;
  const { planningTask, userId, childIssues } = request;

  const qualifyingChildren = getQualifyingChildren(childIssues);
  if (qualifyingChildren.length === 0) {
    logger.info({ linearIssueId: planningTask.linearIssueId, childCount: childIssues.length }, 'Fan-out: no qualifying live direct children');
    return err({ code: 'no_qualifying_children', message: 'No direct children with code-task label found' });
  }

  const preparedChildren = buildPreparedChildren(qualifyingChildren);
  const primaryChild = preparedChildren[0];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess forces an undefined check after preparedChildren[0]; buildPreparedChildren preserves length after the qualifyingChildren guard @preserve */
  if (primaryChild === undefined) {
    return err({ code: 'internal_error', message: 'No child execution tasks were created' });
  }
  /* v8 ignore stop @preserve */
  const persistResult = await persistBatchTransactional(deps, request, preparedChildren, primaryChild.taskId);
  if (!persistResult.ok) {
    return persistResult;
  }

  const childTaskIds = preparedChildren.map(({ taskId }) => taskId);
  if (taskEnqueueService.enqueueMany !== undefined) {
    const enqueueResult = await taskEnqueueService.enqueueMany({ taskIds: childTaskIds, userId });
    if (!enqueueResult.ok && enqueueResult.error.code === 'queue_full') {
      await codeTaskRepo.update(planningTask.id, {
        implementationTaskId: null,
        fanOutChildTaskIds: null,
      });
      return err({ code: 'queue_full', message: enqueueResult.error.message });
    }
    if (!enqueueResult.ok) {
      logger.warn(
        { taskIds: childTaskIds, error: enqueueResult.error },
        'Fan-out: batch enqueue degraded, tasks remain queued without queuedAt stamps',
      );
    }
  } else {
    for (const childTaskId of childTaskIds) {
      const enqueueResult = await taskEnqueueService.enqueue({ taskId: childTaskId, userId });
      if (!enqueueResult.ok && enqueueResult.error.code === 'queue_full') {
        await codeTaskRepo.update(planningTask.id, {
          implementationTaskId: null,
          fanOutChildTaskIds: null,
        });
        return err({ code: 'queue_full', message: enqueueResult.error.message });
      }
      if (!enqueueResult.ok) {
        logger.warn(
          { childTaskId, error: enqueueResult.error },
          'Fan-out: failed to enqueue child task (task remains queued)',
        );
      }
    }
  }

  return ok({
    childTaskIds,
    primaryChildTaskId: primaryChild.taskId,
    primaryChildIssueId: primaryChild.child.identifier,
  });
}
