import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../repositories/codeTaskRepository.js';
import type { CodeTask } from '../models/codeTask.js';
import type { Logger } from 'pino';
import { buildLockCleanups, type LockCleanupInfo } from '../utils/prTaskLock.js';

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
  locksToCleanup: LockCleanupInfo[];
}

export type DetectZombieTasksUseCase = () => Promise<Result<ZombieDetectionResult>>;

type ZombieInterruption =
  | { kind: 'skipped' }
  | { kind: 'interrupted'; task: CodeTask };

function isSameStaleExecution(
  candidate: CodeTask,
  current: CodeTask,
  staleThreshold: Date,
): boolean {
  const candidateHeartbeat = candidate.lastHeartbeat?.toMillis();
  const currentHeartbeat = current.lastHeartbeat?.toMillis();
  return current.status === candidate.status
    && (current.status === 'dispatched' || current.status === 'running')
    && current.dispatchToken === candidate.dispatchToken
    && candidateHeartbeat !== undefined
    && currentHeartbeat === candidateHeartbeat
    && currentHeartbeat < staleThreshold.getTime();
}

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
      locksToCleanup: [],
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

    if (codeTaskRepository.runInTransaction === undefined) {
      logger.error('Atomic zombie task interruption is unavailable');
      return err(new Error('Atomic zombie task interruption is unavailable'));
    }

    for (const task of zombies) {
      try {
        const updateResult = await codeTaskRepository.runInTransaction<ZombieInterruption>(async (transaction) => {
          const currentResult = await codeTaskRepository.findById(task.id, { transaction });
          if (!currentResult.ok) {
            if (currentResult.error.code === 'NOT_FOUND') {
              return ok({ kind: 'skipped' as const });
            }
            return err(currentResult.error);
          }
          if (!isSameStaleExecution(task, currentResult.value, staleThreshold)) {
            return ok({ kind: 'skipped' as const });
          }

          const interruptionResult = await codeTaskRepository.update(
            task.id,
            { status: 'interrupted' },
            { transaction },
          );
          if (!interruptionResult.ok) return err(interruptionResult.error);
          return ok({ kind: 'interrupted' as const, task: interruptionResult.value });
        });

        if (!updateResult.ok) {
          logger.error(
            { taskId: task.id, error: updateResult.error.message },
            'Failed to interrupt zombie task'
          );
          result.errors.push(task.id);
        } else if (updateResult.value.kind === 'interrupted') {
          logger.info({ taskId: task.id }, 'Interrupted zombie task');
          result.interrupted++;
          result.locksToCleanup.push(...buildLockCleanups(updateResult.value.task));
        } else {
          logger.info({ taskId: task.id }, 'Skipped zombie task because its execution fence changed');
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
