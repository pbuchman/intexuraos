/**
 * Repository decorator that transparently hooks into task create/update/delete
 * to maintain group summary documents (fire-and-forget).
 *
 * Design reference: docs/superpowers/specs/2026-03-31-group-level-aggregation-design.md
 * Section: "Write Path: Repository Decorator"
 */

import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository, UpdateTaskInput } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskGroupSummaryRepository } from '../../domain/ports/taskGroupSummaryRepository.js';
import type { CodeTask } from '../../domain/models/codeTask.js';

function hasGroupSummaryRelevantResultChange(input: UpdateTaskInput): boolean {
  return input.result?.prUrl !== undefined ||
    input.result?.merge_ready !== undefined ||
    input.result?.merge_ready_reason !== undefined ||
    input.result?.pull_request_outcome_label !== undefined ||
    input.result?.execution_outcome_label !== undefined ||
    input.result?.needs_remediation !== undefined ||
    input.result?.requires_re_review !== undefined;
}

function hasGroupSummaryRelevantPrTerminalChange(input: UpdateTaskInput): boolean {
  return input.prMergedAt !== undefined ||
    input.prClosedAt !== undefined ||
    input.prNumber !== undefined ||
    input.implementationTaskId !== undefined ||
    input.fanOutChildTaskIds !== undefined ||
    input.requiresReReview !== undefined;
}

function groupKeyOf(task: CodeTask): string {
  return task.linearIssueId ?? `standalone_${task.id}`;
}

export function withGroupUpdates(
  inner: CodeTaskRepository,
  groupSummaryRepo: TaskGroupSummaryRepository,
  logger: Logger,
): CodeTaskRepository {
  const groupMaintenance = new Map<string, Promise<void>>();

  function scheduleGroupMaintenance(
    task: CodeTask,
    operation: () => Promise<void>,
    failureMessage: string,
  ): void {
    const key = `${task.userId}:${groupKeyOf(task)}`;
    const previous = groupMaintenance.get(key);
    const run = previous === undefined ? operation() : previous.then(operation, operation);
    const settled = run.catch((error: unknown) => {
      logger.warn({ error, taskId: task.id }, failureMessage);
    }).finally(() => {
      if (groupMaintenance.get(key) === settled) {
        groupMaintenance.delete(key);
      }
    });
    groupMaintenance.set(key, settled);
  }

  return {
    ...inner,

    create: async (input, options): ReturnType<CodeTaskRepository['create']> => {
      const result = await inner.create(input, options);
      if (
        result.ok
        && options?.transaction === undefined
        && result.value.agentType !== 'ask_agent'
      ) {
        scheduleGroupMaintenance(
          result.value,
          () => groupSummaryRepo.updateAfterCreate(result.value),
          'Group summary update failed after create',
        );
      }
      return result;
    },

    update: async (taskId, input, options): ReturnType<CodeTaskRepository['update']> => {
      const shouldUpdateGroupSummary =
        options?.transaction === undefined &&
        (
          input.status !== undefined ||
          hasGroupSummaryRelevantResultChange(input) ||
          hasGroupSummaryRelevantPrTerminalChange(input)
        );
      let oldTaskResult;
      if (shouldUpdateGroupSummary) {
        oldTaskResult = await inner.findById(taskId);
      }

      const result = await inner.update(taskId, input, options);

      if (result.ok && shouldUpdateGroupSummary && oldTaskResult?.ok === true && result.value.agentType !== 'ask_agent') {
        const oldTask = oldTaskResult.value;
        const newTask = result.value;
        scheduleGroupMaintenance(
          newTask,
          async () => {
            await groupSummaryRepo.updateAfterStatusChange(oldTask, newTask);
            if (newTask.status !== 'archived' || oldTask.status === 'archived') return;
            await groupSummaryRepo.recomputeGroupFromSource(newTask.userId, groupKeyOf(newTask));
          },
          'Group summary update failed after status change',
        );
      }
      return result;
    },

    deleteTask: async (taskId, userId): ReturnType<CodeTaskRepository['deleteTask']> => {
      const oldTaskResult = await inner.findByIdForUser(taskId, userId);
      const result = await inner.deleteTask(taskId, userId);

      if (result.ok && oldTaskResult.ok && oldTaskResult.value.agentType !== 'ask_agent') {
        const deletedTask = oldTaskResult.value;
        scheduleGroupMaintenance(
          deletedTask,
          async () => {
            await groupSummaryRepo.updateAfterDelete(deletedTask);
            await groupSummaryRepo.recomputeGroupFromSource(deletedTask.userId, groupKeyOf(deletedTask));
          },
          'Group summary update failed after delete',
        );
      }
      return result;
    },
  };
}
