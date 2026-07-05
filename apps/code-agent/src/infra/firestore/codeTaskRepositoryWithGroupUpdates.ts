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

function hasGroupSummaryRelevantResultChange(input: UpdateTaskInput): boolean {
  return input.result?.merge_ready !== undefined ||
    input.result?.merge_ready_reason !== undefined ||
    input.result?.pull_request_outcome_label !== undefined ||
    input.result?.execution_outcome_label !== undefined ||
    input.result?.needs_remediation !== undefined ||
    input.result?.requires_re_review !== undefined;
}

function hasGroupSummaryRelevantPrTerminalChange(input: UpdateTaskInput): boolean {
  return input.prMergedAt !== undefined || input.prClosedAt !== undefined;
}

export function withGroupUpdates(
  inner: CodeTaskRepository,
  groupSummaryRepo: TaskGroupSummaryRepository,
  logger: Logger,
): CodeTaskRepository {
  return {
    ...inner,

    create: async (input, options): ReturnType<CodeTaskRepository['create']> => {
      const result = await inner.create(input, options);
      if (result.ok && result.value.agentType !== 'ask_agent') {
        void groupSummaryRepo.updateAfterCreate(result.value).catch((error: unknown) => {
          logger.warn({ error }, 'Group summary update failed after create');
        });
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
        void groupSummaryRepo.updateAfterStatusChange(oldTaskResult.value, result.value).catch((error: unknown) => {
          logger.warn({ error, taskId }, 'Group summary update failed after status change');
        });
      }
      return result;
    },

    deleteTask: async (taskId, userId): ReturnType<CodeTaskRepository['deleteTask']> => {
      const oldTaskResult = await inner.findByIdForUser(taskId, userId);
      const result = await inner.deleteTask(taskId, userId);

      if (result.ok && oldTaskResult.ok && oldTaskResult.value.agentType !== 'ask_agent') {
        void groupSummaryRepo.updateAfterDelete(oldTaskResult.value).catch((error: unknown) => {
          logger.warn({ error, taskId }, 'Group summary update failed after delete');
        });
      }
      return result;
    },
  };
}
