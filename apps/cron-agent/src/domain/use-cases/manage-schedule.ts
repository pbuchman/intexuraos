import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { ScheduleRepository } from '../ports/schedule-repository.js';
import type { ToolRegistry } from '../ports/tool-registry.js';
import type {
  CronSchedule,
  CreateScheduleInput,
  UpdateScheduleInput,
  ListOptions,
  ListSchedulesResponse,
  CronExecution,
} from '../types.js';
import type { ExecuteScheduleDeps } from './execute-schedule.js';
import { executeSchedule } from './execute-schedule.js';
import { computeNextExecution } from '../cron-utils.js';
import { parseSchedule, type ParseScheduleDeps } from './parse-schedule.js';

export interface ScheduleError {
  code: 'NOT_FOUND' | 'VALIDATION_ERROR' | 'PARSE_FAILED' | 'INTERNAL_ERROR' | 'CONFLICT';
  message: string;
}

export interface ManageScheduleDeps {
  logger: Logger;
  scheduleRepo: ScheduleRepository;
  parseDeps: ParseScheduleDeps;
  toolRegistry: ToolRegistry;
  executeDeps: ExecuteScheduleDeps;
}

export interface ScheduleManager {
  create(userId: string, input: CreateScheduleInput): Promise<Result<CronSchedule, ScheduleError>>;
  getById(userId: string, id: string): Promise<Result<CronSchedule, ScheduleError>>;
  list(userId: string, options: ListOptions): Promise<Result<ListSchedulesResponse, ScheduleError>>;
  update(userId: string, id: string, input: UpdateScheduleInput): Promise<Result<CronSchedule, ScheduleError>>;
  delete(userId: string, id: string): Promise<Result<void, ScheduleError>>;
  trigger(userId: string, id: string): Promise<Result<CronExecution, ScheduleError>>;
}

export function createScheduleManager(deps: ManageScheduleDeps): ScheduleManager {
  const { logger: _logger, scheduleRepo, parseDeps, toolRegistry, executeDeps } = deps;

  return {
    async create(
      userId: string,
      input: CreateScheduleInput,
    ): Promise<Result<CronSchedule, ScheduleError>> {
      // Validate service keys
      const availableServices = await toolRegistry.listServiceTools();
      const availableKeys = new Set(availableServices.map((s) => s.key));

      for (const serviceKey of input.action.services) {
        if (!availableKeys.has(serviceKey)) {
          return err({
            code: 'VALIDATION_ERROR',
            message: `Unknown service: ${serviceKey}`,
          });
        }
      }

      // Parse schedule description into cron expression
      const parseResult = await parseSchedule(parseDeps, input.description);
      if (!parseResult.ok) {
        return err({
          code: 'PARSE_FAILED',
          message: parseResult.error.message,
        });
      }

      const { cronExpression } = parseResult.value;
      const nextExecutionAt = computeNextExecution(cronExpression, input.timezone);

      const result = await scheduleRepo.create(userId, {
        ...input,
        cronExpression,
        nextExecutionAt,
      });

      if (!result.ok) {
        return err({ code: 'INTERNAL_ERROR', message: result.error.message });
      }

      return ok(result.value);
    },

    async getById(
      userId: string,
      id: string,
    ): Promise<Result<CronSchedule, ScheduleError>> {
      const result = await scheduleRepo.findById(id);
      if (!result.ok) {
        return err({ code: 'INTERNAL_ERROR', message: result.error.message });
      }
      if (result.value === null) {
        return err({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }
      if (result.value.userId !== userId) {
        return err({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }
      return ok(result.value);
    },

    async list(
      userId: string,
      options: ListOptions,
    ): Promise<Result<ListSchedulesResponse, ScheduleError>> {
      const result = await scheduleRepo.findByUserId(userId, options);
      if (!result.ok) {
        return err({ code: 'INTERNAL_ERROR', message: result.error.message });
      }
      return ok(result.value);
    },

    async update(
      userId: string,
      id: string,
      input: UpdateScheduleInput,
    ): Promise<Result<CronSchedule, ScheduleError>> {
      // Verify ownership
      const existing = await scheduleRepo.findById(id);
      if (!existing.ok) {
        return err({ code: 'INTERNAL_ERROR', message: existing.error.message });
      }
      if (existing.value?.userId !== userId) {
        return err({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      const schedule = existing.value;
      const updates: Partial<CronSchedule> = {};

      if (input.name !== undefined) {
        updates.name = input.name;
      }

      if (input.action !== undefined) {
        // Validate service keys
        const availableServices = await toolRegistry.listServiceTools();
        const availableKeys = new Set(availableServices.map((s) => s.key));

        for (const serviceKey of input.action.services) {
          if (!availableKeys.has(serviceKey)) {
            return err({
              code: 'VALIDATION_ERROR',
              message: `Unknown service: ${serviceKey}`,
            });
          }
        }
        updates.action = input.action;
      }

      if (input.timezone !== undefined) {
        updates.timezone = input.timezone;
      }

      // If description changed, re-parse cron expression
      if (input.description !== undefined) {
        updates.description = input.description;
        const parseResult = await parseSchedule(parseDeps, input.description);
        if (!parseResult.ok) {
          return err({ code: 'PARSE_FAILED', message: parseResult.error.message });
        }
        updates.cronExpression = parseResult.value.cronExpression;
        const tz = input.timezone ?? schedule.timezone;
        updates.nextExecutionAt = computeNextExecution(parseResult.value.cronExpression, tz);
      }

      // Handle status changes
      if (input.status !== undefined) {
        updates.status = input.status;
        if (input.status === 'paused') {
          updates.nextExecutionAt = null;
        } else if (input.status === 'active') {
          const cron = updates.cronExpression ?? schedule.cronExpression;
          const tz = updates.timezone ?? schedule.timezone;
          updates.nextExecutionAt = computeNextExecution(cron, tz);
        }
      }

      const result = await scheduleRepo.update(id, updates);
      if (!result.ok) {
        return err({ code: 'INTERNAL_ERROR', message: result.error.message });
      }
      return ok(result.value);
    },

    async delete(
      userId: string,
      id: string,
    ): Promise<Result<void, ScheduleError>> {
      const existing = await scheduleRepo.findById(id);
      if (!existing.ok) {
        return err({ code: 'INTERNAL_ERROR', message: existing.error.message });
      }
      if (existing.value?.userId !== userId) {
        return err({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      const result = await scheduleRepo.update(id, {
        status: 'deleted',
        nextExecutionAt: null,
      });
      if (!result.ok) {
        return err({ code: 'INTERNAL_ERROR', message: result.error.message });
      }
      return ok(undefined);
    },

    async trigger(
      userId: string,
      id: string,
    ): Promise<Result<CronExecution, ScheduleError>> {
      const existing = await scheduleRepo.findById(id);
      if (!existing.ok) {
        return err({ code: 'INTERNAL_ERROR', message: existing.error.message });
      }
      if (existing.value?.userId !== userId) {
        return err({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }

      // Check for overlapping execution to prevent concurrent triggers
      const runningResult = await executeDeps.executionRepo.findRunningByScheduleId(id);
      if (runningResult.ok && runningResult.value !== null) {
        return err({ code: 'CONFLICT', message: 'Schedule is already running' });
      }

      const result = await executeSchedule(executeDeps, existing.value, 'manual');
      if (!result.ok) {
        return err({ code: 'INTERNAL_ERROR', message: result.error.message });
      }
      return ok(result.value);
    },
  };
}
