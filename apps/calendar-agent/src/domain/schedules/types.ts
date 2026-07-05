import type { Result } from '@intexuraos/common-core';

export const CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE = 'calendar_daily_lookahead';
export const CALENDAR_DAILY_LOOKAHEAD_PROMPT =
  'Send me events that they have in the calendar in the next 24 hours.';

export type CalendarScheduleTaskType = typeof CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE;
export type CalendarScheduleStatus = 'active' | 'paused';

export interface CalendarSchedule {
  id: string;
  userId: string;
  taskType: CalendarScheduleTaskType;
  status: CalendarScheduleStatus;
  cadence: {
    type: 'daily';
    localTime: string;
    timeZone: string;
  };
  payload: {
    prompt: string;
    target: 'intex_agent';
  };
  nextRunAt: string;
  lastRunAt?: string;
  lastRunLocalDate?: string;
  retryRun?: {
    localDate: string;
    scheduledFor: string;
  };
  lease?: {
    ownerId: string;
    expiresAt: string;
  };
  createdAt?: string;
  updatedAt?: string;
  schemaVersion: 1;
}

export interface CalendarScheduleRun {
  id: string;
  scheduleId: string;
  userId: string;
  taskType: CalendarScheduleTaskType;
  status: 'leased' | 'sent' | 'failed';
  localDate: string;
  scheduledFor: string;
  startedAt: string;
  finishedAt?: string;
  matrixEventId?: string;
  error?: string;
  retryable?: boolean;
}

export interface ClaimedCalendarSchedule {
  schedule: CalendarSchedule;
  localDate: string;
  scheduledFor: string;
  startedAt: string;
}

export type MatrixDeliveryStatus =
  | { status: 'ready' }
  | { status: 'setup_required'; reason: string }
  | { status: 'error'; message: string };

export type OutboundMatrixMessageResult =
  | { status: 'sent'; matrixEventId: string }
  | { status: 'setup_required'; reason: string }
  | { status: 'error'; message: string };

export interface WhatsAppScheduleClient {
  getMatrixDeliveryStatus(userId: string): Promise<Result<MatrixDeliveryStatus>>;
  sendOutboundMatrixMessage(input: {
    userId: string;
    target: 'intex_agent';
    text: string;
    startNewSession?: boolean;
    idempotencyKey?: string;
  }): Promise<Result<OutboundMatrixMessageResult>>;
}
