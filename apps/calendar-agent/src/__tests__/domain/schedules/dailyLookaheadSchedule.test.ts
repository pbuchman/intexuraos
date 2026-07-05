import { describe, expect, it } from 'vitest';
import { err } from '@intexuraos/common-core';
import { getDailyLookaheadSchedule } from '../../../domain/schedules/getDailyLookaheadSchedule.js';
import { upsertDailyLookaheadSchedule } from '../../../domain/schedules/upsertDailyLookaheadSchedule.js';
import type { CalendarSchedule } from '../../../domain/index.js';
import {
  FakeCalendarScheduleRepository,
  FakeWhatsAppScheduleClient,
} from '../../fakes.js';

function schedule(overrides: Partial<CalendarSchedule> = {}): CalendarSchedule {
  return {
    id: 'user-123_calendar_daily_lookahead',
    userId: 'user-123',
    taskType: 'calendar_daily_lookahead',
    status: 'active',
    cadence: { type: 'daily', localTime: '09:15', timeZone: 'America/New_York' },
    payload: {
      prompt: 'Send me events that they have in the calendar in the next 24 hours.',
      target: 'intex_agent',
    },
    nextRunAt: '2026-07-04T13:15:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    schemaVersion: 1,
    ...overrides,
  };
}

describe('daily lookahead schedule use cases', () => {
  it('maps delivery status lookup failures while reading a schedule', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.seedSchedule(schedule());
    whatsappClient.setMatrixDeliveryStatusResult(err(new Error('delivery unavailable')));

    const result = await getDailyLookaheadSchedule('user-123', {
      scheduleRepository: repository,
      whatsAppScheduleClient: whatsappClient,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('delivery unavailable');
    }
  });

  it('returns repository read failures before upserting', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setGetByUserAndTaskTypeResult(
      err({ code: 'INTERNAL_ERROR', message: 'schedule read failed' })
    );

    const result = await upsertDailyLookaheadSchedule(
      {
        userId: 'user-123',
        enabled: true,
        localTime: '09:15',
        timeZone: 'America/New_York',
        now: '2026-07-04T12:00:00.000Z',
      },
      {
        scheduleRepository: repository,
        whatsAppScheduleClient: whatsappClient,
      }
    );

    expect(result.ok).toBe(false);
  });

  it('returns repository upsert failures', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.setUpsertResult(
      err({ code: 'INTERNAL_ERROR', message: 'schedule write failed' })
    );

    const result = await upsertDailyLookaheadSchedule(
      {
        userId: 'user-123',
        enabled: true,
        localTime: '09:15',
        timeZone: 'America/New_York',
        now: '2026-07-04T12:00:00.000Z',
      },
      {
        scheduleRepository: repository,
        whatsAppScheduleClient: whatsappClient,
      }
    );

    expect(result.ok).toBe(false);
  });

  it('preserves existing run metadata while updating cadence', async () => {
    const repository = new FakeCalendarScheduleRepository();
    const whatsappClient = new FakeWhatsAppScheduleClient();

    repository.seedSchedule(
      schedule({
        lastRunAt: '2026-07-04T13:15:10.000Z',
        lastRunLocalDate: '2026-07-04',
      })
    );

    const result = await upsertDailyLookaheadSchedule(
      {
        userId: 'user-123',
        enabled: false,
        localTime: '09:15',
        timeZone: 'America/New_York',
        now: '2026-07-04T12:00:00.000Z',
      },
      {
        scheduleRepository: repository,
        whatsAppScheduleClient: whatsappClient,
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.schedule.status).toBe('paused');
      expect(result.value.schedule.lastRunAt).toBe('2026-07-04T13:15:10.000Z');
      expect(result.value.schedule.lastRunLocalDate).toBe('2026-07-04');
      expect(result.value.schedule.nextRunAt).toBe('2026-07-05T13:15:00.000Z');
    }
  });
});
