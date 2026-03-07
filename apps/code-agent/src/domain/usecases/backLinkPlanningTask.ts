/**
 * Best-effort back-link of planning tasks to execution tasks (INT-725).
 *
 * When an execution task is created for a Linear issue, this function
 * finds any existing planned planning task for the same issue and sets
 * its implementationTaskId. This ensures the "Ready to implement" badge
 * no longer shows for tasks that already have an associated execution task.
 *
 * Assumption: at most one planned planning task exists per Linear issue
 * without an implementationTaskId. The repository method uses limit(1)
 * for efficiency based on this assumption.
 */

import type { Logger } from '@intexuraos/common-core';
import type { CodeTask } from '../models/codeTask.js';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';

/**
 * Back-link a planning task to a newly created execution task.
 * Best-effort: failures log a warning but do not propagate.
 */
export async function backLinkPlanningTask(
  codeTaskRepo: CodeTaskRepository,
  logger: Logger,
  task: CodeTask,
): Promise<void> {
  if (task.agentType !== 'execution' || task.linearIssueId === undefined) {
    return;
  }

  try {
    const planningTaskResult = await codeTaskRepo.findPlannedTaskByLinearIssue(task.linearIssueId);
    if (!planningTaskResult.ok) {
      logger.warn({ error: planningTaskResult.error, executionTaskId: task.id }, 'Failed to find planning task for back-link');
      return;
    }
    if (planningTaskResult.value !== null) {
      const backLinkResult = await codeTaskRepo.update(planningTaskResult.value.id, {
        implementationTaskId: task.id,
      });
      if (!backLinkResult.ok) {
        logger.warn({ planningTaskId: planningTaskResult.value.id, executionTaskId: task.id }, 'Failed to back-link planning task to execution task');
      }
    }
  } catch (backLinkError: unknown) {
    logger.warn({ error: backLinkError, executionTaskId: task.id }, 'Best-effort back-link to planning task failed');
  }
}
