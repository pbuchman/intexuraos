import { ok, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarScheduleRepository } from './scheduleRepository.js';
import type { CalendarSchedule, MatrixDeliveryStatus, WhatsAppScheduleClient } from './types.js';
import {
  CALENDAR_DAILY_LOOKAHEAD_PROMPT,
  CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE,
} from './types.js';
import { calculateNextScheduleRunAt, validateScheduleCadence } from './scheduleTime.js';

export interface UpsertDailyLookaheadScheduleRequest {
  userId: string;
  enabled: boolean;
  localTime: string;
  timeZone: string;
  now: string;
}

export interface UpsertDailyLookaheadScheduleDeps {
  scheduleRepository: CalendarScheduleRepository;
  whatsAppScheduleClient: WhatsAppScheduleClient;
}

export async function upsertDailyLookaheadSchedule(
  request: UpsertDailyLookaheadScheduleRequest,
  deps: UpsertDailyLookaheadScheduleDeps
): Promise<Result<{ schedule: CalendarSchedule; delivery: MatrixDeliveryStatus }, CalendarError>> {
  const validation = validateScheduleCadence({
    localTime: request.localTime,
    timeZone: request.timeZone,
  });
  if (!validation.ok) {
    return validation;
  }

  const existing = await deps.scheduleRepository.getByUserAndTaskType(
    request.userId,
    CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE
  );
  if (!existing.ok) {
    return existing;
  }

  const scheduleId = `${request.userId}_${CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE}`;
  const schedule: CalendarSchedule = {
    id: scheduleId,
    userId: request.userId,
    taskType: CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE,
    status: request.enabled ? 'active' : 'paused',
    cadence: {
      type: 'daily',
      localTime: request.localTime,
      timeZone: request.timeZone,
    },
    payload: {
      prompt: CALENDAR_DAILY_LOOKAHEAD_PROMPT,
      target: 'intex_agent',
    },
    nextRunAt: calculateNextScheduleRunAt({
      localTime: request.localTime,
      timeZone: request.timeZone,
      now: request.now,
      ...(existing.value?.lastRunLocalDate !== undefined && {
        lastRunLocalDate: existing.value.lastRunLocalDate,
      }),
    }),
    ...(existing.value?.lastRunAt !== undefined && { lastRunAt: existing.value.lastRunAt }),
    ...(existing.value?.lastRunLocalDate !== undefined && {
      lastRunLocalDate: existing.value.lastRunLocalDate,
    }),
    createdAt: existing.value?.createdAt ?? request.now,
    updatedAt: request.now,
    schemaVersion: 1,
  };

  const upserted = await deps.scheduleRepository.upsert(schedule);
  if (!upserted.ok) {
    return upserted;
  }

  const deliveryResult = await deps.whatsAppScheduleClient.getMatrixDeliveryStatus(request.userId);
  if (!deliveryResult.ok) {
    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: deliveryResult.error.message,
      },
    };
  }

  return ok({
    schedule: upserted.value,
    delivery: deliveryResult.value,
  });
}
