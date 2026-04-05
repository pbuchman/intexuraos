import type { Result } from '@intexuraos/common-core';
import type { CronSchedule, CreateScheduleInput, ListOptions, ListSchedulesResponse } from '../types.js';

export interface ScheduleRepositoryError {
  code: 'NOT_FOUND' | 'INTERNAL_ERROR';
  message: string;
}

export interface ScheduleRepository {
  create(userId: string, input: CreateScheduleInput & { scheduleSummary: string; cronExpression: string; nextExecutionAt: string | null }): Promise<Result<CronSchedule, ScheduleRepositoryError>>;
  findById(id: string): Promise<Result<CronSchedule | null, ScheduleRepositoryError>>;
  findByUserId(userId: string, options: ListOptions): Promise<Result<ListSchedulesResponse, ScheduleRepositoryError>>;
  findDueSchedules(now: Date): Promise<Result<CronSchedule[], ScheduleRepositoryError>>;
  update(id: string, updates: Partial<CronSchedule>): Promise<Result<CronSchedule, ScheduleRepositoryError>>;
  incrementCounters(
    id: string,
    counters: { executionCount?: boolean; failureCount?: boolean },
    metadata: { lastExecutedAt: string; nextExecutionAt: string | null },
  ): Promise<Result<void, ScheduleRepositoryError>>;
}
