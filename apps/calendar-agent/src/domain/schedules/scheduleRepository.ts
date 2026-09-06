import type { Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type {
  CalendarSchedule,
  CalendarScheduleTaskType,
  ClaimedCalendarSchedule,
} from './types.js';

export interface ClaimDueSchedulesInput {
  now: string;
  limit: number;
  leaseOwnerId: string;
  leaseDurationMs: number;
}

export interface MarkRunSentInput {
  scheduleId: string;
  userId: string;
  taskType: CalendarScheduleTaskType;
  localDate: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string;
  matrixEventId: string;
  nextRunAt: string;
}

export interface MarkRunFailedInput {
  scheduleId: string;
  userId: string;
  taskType: CalendarScheduleTaskType;
  localDate: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string;
  error: string;
  retryable: boolean;
  nextRunAt: string;
}

export interface CalendarScheduleRepository {
  upsert(schedule: CalendarSchedule): Promise<Result<CalendarSchedule, CalendarError>>;
  getByUserAndTaskType(
    userId: string,
    taskType: CalendarScheduleTaskType
  ): Promise<Result<CalendarSchedule | null, CalendarError>>;
  claimDueSchedules(
    input: ClaimDueSchedulesInput
  ): Promise<Result<ClaimedCalendarSchedule[], CalendarError>>;
  markRunSent(input: MarkRunSentInput): Promise<Result<void, CalendarError>>;
  markRunFailed(input: MarkRunFailedInput): Promise<Result<void, CalendarError>>;
}
