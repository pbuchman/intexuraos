import { err, ok, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarScheduleRepository } from './scheduleRepository.js';
import type { CalendarSchedule, WhatsAppScheduleClient, MatrixDeliveryStatus } from './types.js';
import { CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE } from './types.js';

export interface GetDailyLookaheadScheduleDeps {
  scheduleRepository: CalendarScheduleRepository;
  whatsAppScheduleClient: WhatsAppScheduleClient;
}

export async function getDailyLookaheadSchedule(
  userId: string,
  deps: GetDailyLookaheadScheduleDeps
): Promise<Result<{ schedule: CalendarSchedule | null; delivery: MatrixDeliveryStatus }, CalendarError>> {
  const scheduleResult = await deps.scheduleRepository.getByUserAndTaskType(
    userId,
    CALENDAR_DAILY_LOOKAHEAD_TASK_TYPE
  );
  if (!scheduleResult.ok) {
    return scheduleResult;
  }

  const deliveryResult = await deps.whatsAppScheduleClient.getMatrixDeliveryStatus(userId);
  if (!deliveryResult.ok) {
    return err({
      code: 'INTERNAL_ERROR',
      message: deliveryResult.error.message,
    });
  }

  return ok({
    schedule: scheduleResult.value,
    delivery: deliveryResult.value,
  });
}
