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
  ScheduleAction,
} from '../types.js';
import type { ExecuteScheduleDeps } from './execute-schedule.js';
import { executeSchedule } from './execute-schedule.js';
import { computeNextExecution } from '../cron-utils.js';
import { parseSchedule, type ParseScheduleDeps } from './parse-schedule.js';
import { normalizeScheduleAction } from '../types.js';
import type { ServiceToolInfo } from '../ports/tool-registry.js';

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

  function validateAction(
    action: ScheduleAction,
    availableServices: ServiceToolInfo[],
  ): Result<ScheduleAction, ScheduleError> {
    const availableKeys = new Set(availableServices.map((service) => service.key));

    for (const serviceKey of action.services) {
      if (!availableKeys.has(serviceKey)) {
        return err({
          code: 'VALIDATION_ERROR',
          message: `Unknown service: ${serviceKey}`,
        });
      }
    }

    const selectedServices = new Set(action.services);
    const toolToService = new Map<string, string>();
    for (const service of availableServices) {
      for (const tool of service.tools) {
        toolToService.set(tool.name, service.key);
      }
    }

    for (const toolName of action.preferredTools) {
      const serviceKey = toolToService.get(toolName);
      if (serviceKey === undefined) {
        return err({
          code: 'VALIDATION_ERROR',
          message: `Unknown preferred tool: ${toolName}`,
        });
      }
      if (!selectedServices.has(serviceKey)) {
        return err({
          code: 'VALIDATION_ERROR',
          message: `Preferred tool ${toolName} must belong to one of the selected services`,
        });
      }
    }

    return ok(action);
  }

  return {
    async create(
      userId: string,
      input: CreateScheduleInput,
    ): Promise<Result<CronSchedule, ScheduleError>> {
      // Enforce per-user schedule limit
      const MAX_SCHEDULES_PER_USER = 50;
      const existingResult = await scheduleRepo.findByUserId(userId, { limit: MAX_SCHEDULES_PER_USER, status: ['active', 'paused'] });
      if (existingResult.ok && existingResult.value.schedules.length >= MAX_SCHEDULES_PER_USER) {
        return err({
          code: 'VALIDATION_ERROR',
          message: `Maximum of ${String(MAX_SCHEDULES_PER_USER)} schedules per user reached`,
        });
      }

      const availableServices = await toolRegistry.listServiceTools();
      const normalizedAction = normalizeScheduleAction(input.action);
      const actionValidation = validateAction(normalizedAction, availableServices);
      if (!actionValidation.ok) {
        return actionValidation;
      }

      // Parse schedule description into cron expression
      const parseResult = await parseSchedule(parseDeps, input.schedule);
      if (!parseResult.ok) {
        return err({
          code: 'PARSE_FAILED',
          message: parseResult.error.message,
        });
      }

      const { cronExpression, humanSummary } = parseResult.value;
      const nextExecutionAt = computeNextExecution(cronExpression, input.timezone);

      const result = await scheduleRepo.create(userId, {
        ...input,
        action: normalizedAction,
        scheduleSummary: humanSummary,
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
        const availableServices = await toolRegistry.listServiceTools();
        const normalizedAction = normalizeScheduleAction(input.action);
        const actionValidation = validateAction(normalizedAction, availableServices);
        if (!actionValidation.ok) {
          return actionValidation;
        }
        updates.action = normalizedAction;
      }

      if (input.timezone !== undefined) {
        updates.timezone = input.timezone;
      }

      // If schedule changed, re-parse cron expression
      if (input.schedule !== undefined) {
        const parseResult = await parseSchedule(parseDeps, input.schedule);
        if (!parseResult.ok) {
          return err({ code: 'PARSE_FAILED', message: parseResult.error.message });
        }
        updates.scheduleSummary = parseResult.value.humanSummary;
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
