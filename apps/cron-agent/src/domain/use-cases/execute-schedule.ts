import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { ExecutionRepository } from '../ports/execution-repository.js';
import type { ScheduleRepository } from '../ports/schedule-repository.js';
import type { CronSchedule, CronExecution, TriggerType } from '../types.js';
import { computeNextExecution } from '../cron-utils.js';
import { executeAction, type ExecuteActionDeps } from './execute-action.js';

export interface ExecuteScheduleError {
  code: 'EXECUTION_FAILED' | 'INTERNAL_ERROR';
  message: string;
}

export interface ExecuteScheduleDeps {
  logger: Logger;
  executionRepo: ExecutionRepository;
  scheduleRepo: ScheduleRepository;
  actionDeps: ExecuteActionDeps;
}

export async function executeSchedule(
  deps: ExecuteScheduleDeps,
  schedule: CronSchedule,
  trigger: TriggerType,
): Promise<Result<CronExecution, ExecuteScheduleError>> {
  const { logger, executionRepo, scheduleRepo, actionDeps } = deps;

  // Create execution record with status 'running'
  const createResult = await executionRepo.create({
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    userId: schedule.userId,
    trigger,
  });

  if (!createResult.ok) {
    return err({ code: 'INTERNAL_ERROR', message: createResult.error.message });
  }

  const execution = createResult.value;
  const startTime = Date.now();

  try {
    const actionResult = await executeAction(actionDeps, schedule.action);

    const durationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();

    if (!actionResult.ok) {
      // Update execution as failure
      const failedUpdate = await executionRepo.update(execution.id, {
        status: 'failure',
        completedAt,
        durationMs,
        error: actionResult.error.message,
      });

      // Update schedule failure count
      await scheduleRepo.update(schedule.id, {
        lastExecutedAt: completedAt,
        nextExecutionAt: computeNextExecution(schedule.cronExpression, schedule.timezone),
        executionCount: schedule.executionCount + 1,
        failureCount: schedule.failureCount + 1,
      });

      if (failedUpdate.ok) {
        return ok(failedUpdate.value);
      }
      return ok({
        ...execution,
        status: 'failure' as const,
        completedAt,
        durationMs,
        error: actionResult.error.message,
      });
    }

    const { toolCalls, agentResponse, tokenUsage } = actionResult.value;

    // Update execution as success
    const successUpdate = await executionRepo.update(execution.id, {
      status: 'success',
      completedAt,
      durationMs,
      toolCalls,
      agentResponse,
      tokenUsage,
    });

    // Update schedule counters
    await scheduleRepo.update(schedule.id, {
      lastExecutedAt: completedAt,
      nextExecutionAt: computeNextExecution(schedule.cronExpression, schedule.timezone),
      executionCount: schedule.executionCount + 1,
    });

    if (successUpdate.ok) {
      return ok(successUpdate.value);
    }
    return ok({
      ...execution,
      status: 'success' as const,
      completedAt,
      durationMs,
      toolCalls,
      agentResponse,
      tokenUsage,
    });
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMsg = String(error);

    await executionRepo.update(execution.id, {
      status: 'failure',
      completedAt: new Date().toISOString(),
      durationMs,
      error: errorMsg,
    });

    await scheduleRepo.update(schedule.id, {
      lastExecutedAt: new Date().toISOString(),
      nextExecutionAt: computeNextExecution(schedule.cronExpression, schedule.timezone),
      executionCount: schedule.executionCount + 1,
      failureCount: schedule.failureCount + 1,
    });

    logger.error({ error: errorMsg, scheduleId: schedule.id }, 'Schedule execution threw');
    return err({ code: 'EXECUTION_FAILED', message: errorMsg });
  }
}
