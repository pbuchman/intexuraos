import type { Logger } from '@intexuraos/common-core';
import type { ExecutionRepository } from '../ports/execution-repository.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';
import { executeSchedule, type ExecuteScheduleDeps } from './execute-schedule.js';

export interface TickResult {
  executed: number;
  skipped: number;
  errors: number;
}

export interface HandleTickDeps {
  logger: Logger;
  scheduleRepo: ScheduleRepository;
  executionRepo: ExecutionRepository;
  executeDeps: ExecuteScheduleDeps;
}

export async function handleTick(deps: HandleTickDeps): Promise<TickResult> {
  const { logger, scheduleRepo, executionRepo, executeDeps } = deps;
  const now = new Date();

  const dueResult = await scheduleRepo.findDueSchedules(now);
  if (!dueResult.ok) {
    logger.error({ error: dueResult.error }, 'Failed to find due schedules');
    return { executed: 0, skipped: 0, errors: 1 };
  }

  const dueSchedules = dueResult.value;
  if (dueSchedules.length >= 100) {
    logger.warn({ count: dueSchedules.length }, 'Schedule saturation — limit reached, some due schedules may be deferred to next tick');
  }
  logger.info({ count: dueSchedules.length }, 'Found due schedules');

  let executed = 0;
  let skipped = 0;
  let errors = 0;

  for (const schedule of dueSchedules) {
    // Check for overlapping execution
    const runningResult = await executionRepo.findRunningByScheduleId(schedule.id);
    if (runningResult.ok && runningResult.value !== null) {
      logger.info({ scheduleId: schedule.id }, 'Skipping schedule — already running');
      skipped++;
      continue;
    }

    const result = await executeSchedule(executeDeps, schedule, 'scheduled');
    if (result.ok) {
      executed++;
    } else {
      logger.error(
        { scheduleId: schedule.id, error: result.error },
        'Schedule execution failed',
      );
      errors++;
    }
  }

  logger.info({ executed, skipped, errors }, 'Tick completed');
  return { executed, skipped, errors };
}
