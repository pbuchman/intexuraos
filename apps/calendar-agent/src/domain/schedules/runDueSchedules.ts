import { ok, type Logger, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarScheduleRepository } from './scheduleRepository.js';
import type { WhatsAppScheduleClient } from './types.js';
import { calculateNextDailyRunAfterLocalDate } from './scheduleTime.js';

const RETRY_INTERVAL_MS = 15 * 60 * 1000;

export interface RunDueSchedulesRequest {
  now: string;
  batchSize: number;
  leaseOwnerId: string;
}

export interface RunDueSchedulesDeps {
  scheduleRepository: CalendarScheduleRepository;
  whatsAppScheduleClient: WhatsAppScheduleClient;
  logger: Logger;
}

export async function runDueSchedules(
  request: RunDueSchedulesRequest,
  deps: RunDueSchedulesDeps
): Promise<Result<{ claimed: number; sent: number; failed: number }, CalendarError>> {
  const claimResult = await deps.scheduleRepository.claimDueSchedules({
    now: request.now,
    limit: request.batchSize,
    leaseOwnerId: request.leaseOwnerId,
    leaseDurationMs: RETRY_INTERVAL_MS,
  });
  if (!claimResult.ok) {
    return claimResult;
  }

  let sent = 0;
  let failed = 0;

  for (const claimed of claimResult.value) {
    const sendResult = await deps.whatsAppScheduleClient.sendOutboundMatrixMessage({
      userId: claimed.schedule.userId,
      target: claimed.schedule.payload.target,
      text: claimed.schedule.payload.prompt,
      startNewSession: true,
      idempotencyKey: `calendar:${claimed.schedule.id}:${claimed.localDate}`,
    });

    const nextDailyRunAt = calculateNextDailyRunAfterLocalDate(
      claimed.localDate,
      claimed.schedule.cadence.localTime,
      claimed.schedule.cadence.timeZone
    );

    if (!sendResult.ok) {
      failed += 1;
      const retryAt = new Date(
        new Date(request.now).getTime() + RETRY_INTERVAL_MS
      ).toISOString();
      const markFailed = await deps.scheduleRepository.markRunFailed({
        scheduleId: claimed.schedule.id,
        userId: claimed.schedule.userId,
        taskType: claimed.schedule.taskType,
        localDate: claimed.localDate,
        scheduledFor: claimed.scheduledFor,
        startedAt: claimed.startedAt,
        finishedAt: request.now,
        error: sendResult.error.message,
        retryable: true,
        nextRunAt: retryAt,
      });
      if (!markFailed.ok) {
        return markFailed;
      }
      continue;
    }

    if (sendResult.value.status === 'setup_required') {
      failed += 1;
      const markFailed = await deps.scheduleRepository.markRunFailed({
        scheduleId: claimed.schedule.id,
        userId: claimed.schedule.userId,
        taskType: claimed.schedule.taskType,
        localDate: claimed.localDate,
        scheduledFor: claimed.scheduledFor,
        startedAt: claimed.startedAt,
        finishedAt: request.now,
        error: sendResult.value.reason,
        retryable: false,
        nextRunAt: nextDailyRunAt,
      });
      if (!markFailed.ok) {
        return markFailed;
      }
      continue;
    }

    if (sendResult.value.status === 'error') {
      failed += 1;
      const retryAt = new Date(
        new Date(request.now).getTime() + RETRY_INTERVAL_MS
      ).toISOString();
      const markFailed = await deps.scheduleRepository.markRunFailed({
        scheduleId: claimed.schedule.id,
        userId: claimed.schedule.userId,
        taskType: claimed.schedule.taskType,
        localDate: claimed.localDate,
        scheduledFor: claimed.scheduledFor,
        startedAt: claimed.startedAt,
        finishedAt: request.now,
        error: sendResult.value.message,
        retryable: true,
        nextRunAt: retryAt,
      });
      if (!markFailed.ok) {
        return markFailed;
      }
      continue;
    }

    const markSent = await deps.scheduleRepository.markRunSent({
      scheduleId: claimed.schedule.id,
      userId: claimed.schedule.userId,
      taskType: claimed.schedule.taskType,
      localDate: claimed.localDate,
      scheduledFor: claimed.scheduledFor,
      startedAt: claimed.startedAt,
      finishedAt: request.now,
      matrixEventId: sendResult.value.matrixEventId,
      nextRunAt: nextDailyRunAt,
    });
    if (!markSent.ok) {
      return markSent;
    }
    sent += 1;
  }

  return ok({
    claimed: claimResult.value.length,
    sent,
    failed,
  });
}
