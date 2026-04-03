/**
 * Repository decorator that transparently hooks into task create/update/delete
 * to maintain group summary documents (fire-and-forget).
 *
 * Design reference: docs/superpowers/specs/2026-03-31-group-level-aggregation-design.md
 * Section: "Write Path: Repository Decorator"
 */

import type { Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskGroupSummaryRepository } from '../../domain/ports/taskGroupSummaryRepository.js';

export function withGroupUpdates(
  inner: CodeTaskRepository,
  groupSummaryRepo: TaskGroupSummaryRepository,
  logger: Logger,
): CodeTaskRepository {
  return {
    ...inner,

    create: async (input, options): ReturnType<CodeTaskRepository['create']> => {
      const result = await inner.create(input, options);
      if (result.ok) {
        void groupSummaryRepo.updateAfterCreate(result.value).catch((error: unknown) => {
          logger.warn({ error }, 'Group summary update failed after create');
        });
      }
      return result;
    },

    update: async (taskId, input): ReturnType<CodeTaskRepository['update']> => {
      // Only read old task if status is changing — saves the extra Firestore read
      // on heartbeat updates, workerLocation updates, etc.
      let oldTaskResult;
      if (input.status !== undefined) {
        oldTaskResult = await inner.findById(taskId);
      }

      const result = await inner.update(taskId, input);

      if (result.ok && input.status !== undefined && oldTaskResult?.ok === true) {
        void groupSummaryRepo.updateAfterStatusChange(oldTaskResult.value, result.value).catch((error: unknown) => {
          logger.warn({ error, taskId }, 'Group summary update failed after status change');
        });
      }
      return result;
    },

    deleteTask: async (taskId, userId): ReturnType<CodeTaskRepository['deleteTask']> => {
      const oldTaskResult = await inner.findByIdForUser(taskId, userId);
      const result = await inner.deleteTask(taskId, userId);

      if (result.ok && oldTaskResult.ok) {
        void groupSummaryRepo.updateAfterDelete(oldTaskResult.value).catch((error: unknown) => {
          logger.warn({ error, taskId }, 'Group summary update failed after delete');
        });
      }
      return result;
    },
  };
}
