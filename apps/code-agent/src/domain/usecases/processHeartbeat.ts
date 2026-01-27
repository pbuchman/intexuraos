import type { Result } from '@intexuraos/common-core';
import { getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { Logger } from 'pino';

export interface ProcessHeartbeatDeps {
  codeTaskRepository: CodeTaskRepository;
  logger: Logger;
}

export interface HeartbeatResult {
  processed: number;
  notFound: string[];
}

export type ProcessHeartbeatUseCase = (taskIds: string[]) => Promise<Result<HeartbeatResult>>;

/**
 * Creates a use case for processing heartbeats from the orchestrator.
 * Updates the updatedAt and lastHeartbeat fields for running tasks to enable zombie detection.
 *
 * Design reference: INT-372
 */
export function createProcessHeartbeatUseCase(
  deps: ProcessHeartbeatDeps
): ProcessHeartbeatUseCase {
  const { codeTaskRepository, logger } = deps;

  return async (taskIds: string[]): Promise<Result<HeartbeatResult>> => {
    const result: HeartbeatResult = {
      processed: 0,
      notFound: [],
    };

    for (const taskId of taskIds) {
      try {
        const taskResult = await codeTaskRepository.findById(taskId);

        if (!taskResult.ok) {
          result.notFound.push(taskId);
          logger.warn({ taskId }, 'Heartbeat for unknown task');
          continue;
        }

        const task = taskResult.value;

        // Only update running/dispatched tasks
        if (task.status !== 'running' && task.status !== 'dispatched') {
          logger.debug({ taskId, status: task.status }, 'Skipping heartbeat for non-running task');
          continue;
        }

        // Update updatedAt to refresh the heartbeat and add lastHeartbeat timestamp
        const updateResult = await codeTaskRepository.update(taskId, {
          updatedAt: new Date(),
          lastHeartbeat: new Date(),
        });

        if (!updateResult.ok) {
          logger.error({ taskId, error: updateResult.error.message }, 'Failed to update task heartbeat');
          continue;
        }

        result.processed++;
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ taskId, error: message }, 'Failed to process heartbeat for task');
      }
    }

    logger.info(result, 'Heartbeat processing completed');
    return ok(result);
  };
}
