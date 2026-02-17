import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { Logger } from 'pino';

/**
 * Minutes of inactivity before a task is considered a zombie.
 * Design reference: INT-371
 */
const ZOMBIE_THRESHOLD_MINUTES = 30;

export interface DetectZombieTasksDeps {
  codeTaskRepository: CodeTaskRepository;
  logger: Logger;
}

export interface ZombieDetectionResult {
  detected: number;
  interrupted: number;
  errors: string[];
}

export type DetectZombieTasksUseCase = () => Promise<Result<ZombieDetectionResult>>;

/**
 * Creates a use case for detecting and interrupting zombie tasks.
 * A zombie task is one in running/dispatched status that hasn't been updated
 * within the threshold period (30 minutes by default).
 *
 * Design reference: INT-371
 */
export function createDetectZombieTasksUseCase(
  deps: DetectZombieTasksDeps
): DetectZombieTasksUseCase {
  const { codeTaskRepository, logger } = deps;

  return async (): Promise<Result<ZombieDetectionResult>> => {
    const result: ZombieDetectionResult = {
      detected: 0,
      interrupted: 0,
      errors: [],
    };

    // Calculate stale threshold
    const staleThreshold = new Date(Date.now() - ZOMBIE_THRESHOLD_MINUTES * 60 * 1000);

    logger.info({ staleThreshold }, 'Starting zombie task detection');

    const findResult = await codeTaskRepository.findZombieTasks(staleThreshold);

    if (!findResult.ok) {
      logger.error({ error: findResult.error.message }, 'Failed to find zombie tasks');
      return err(new Error(findResult.error.message));
    }

    const zombies = findResult.value;
    result.detected = zombies.length;

    if (zombies.length === 0) {
      logger.info('No zombie tasks detected');
      return ok(result);
    }

    logger.info({ count: zombies.length }, 'Zombie tasks detected, interrupting...');

    for (const task of zombies) {
      try {
        const updateResult = await codeTaskRepository.update(task.id, {
          status: 'interrupted',
        });

        if (!updateResult.ok) {
          logger.error(
            { taskId: task.id, error: updateResult.error.message },
            'Failed to interrupt zombie task'
          );
          result.errors.push(task.id);
        } else {
          logger.info({ taskId: task.id }, 'Interrupted zombie task');
          result.interrupted++;
        }
      } catch (error) {
        const message = getErrorMessage(error);
        logger.error({ taskId: task.id, error: message }, 'Failed to interrupt zombie task');
        result.errors.push(task.id);
      }
    }

    logger.info(
      {
        detected: result.detected,
        interrupted: result.interrupted,
        errors: result.errors.length,
      },
      'Zombie task detection completed'
    );

    return ok(result);
  };
}
