import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createFakeFirestore,
  resetFirestore,
  setFirestore,
} from '@intexuraos/infra-firestore';
import { createCalendarScheduleRepository } from '../../../infra/firestore/calendarScheduleRepository.js';
import type { CalendarSchedule } from '../../../domain/index.js';

describe('calendarScheduleRepository', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;

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
      schemaVersion: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Parameters<typeof setFirestore>[0]);
  });

  afterEach(() => {
    resetFirestore();
  });

  it('upserts and looks up a schedule by user and task type', async () => {
    const repository = createCalendarScheduleRepository();

    const created = await repository.upsert(schedule());

    expect(created.ok).toBe(true);

    const loaded = await repository.getByUserAndTaskType(
      'user-123',
      'calendar_daily_lookahead'
    );

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).not.toBeNull();
      expect(loaded.value?.cadence).toEqual({
        type: 'daily',
        localTime: '09:15',
        timeZone: 'America/New_York',
      });
    }
  });

  it('preserves createdAt on updates and uses provided createdAt on inserts', async () => {
    const repository = createCalendarScheduleRepository();

    const inserted = await repository.upsert(
      schedule({
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-04T00:00:00.000Z',
      })
    );
    expect(inserted.ok).toBe(true);
    if (inserted.ok) {
      expect(inserted.value.createdAt).toBe('2026-07-01T00:00:00.000Z');
    }

    const updated = await repository.upsert(
      schedule({
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-05T00:00:00.000Z',
      })
    );

    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.createdAt).toBe('2026-07-01T00:00:00.000Z');
      expect(updated.value.updatedAt).toBe('2026-07-05T00:00:00.000Z');
    }
  });

  it('clears stale retry and lease state when a schedule is upserted without them', async () => {
    const repository = createCalendarScheduleRepository();
    await repository.upsert(schedule());

    await repository.markRunFailed({
      scheduleId: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      localDate: '2026-07-04',
      scheduledFor: '2026-07-04T13:15:00.000Z',
      startedAt: '2026-07-04T13:15:00.000Z',
      finishedAt: '2026-07-04T13:15:05.000Z',
      error: 'socket hang up',
      retryable: true,
      nextRunAt: '2026-07-04T13:30:00.000Z',
    });
    await repository.upsert(
      schedule({
        cadence: { type: 'daily', localTime: '10:00', timeZone: 'America/New_York' },
        nextRunAt: '2026-07-04T14:00:00.000Z',
      })
    );

    const loaded = await repository.getByUserAndTaskType('user-123', 'calendar_daily_lookahead');

    expect(loaded.ok).toBe(true);
    if (loaded.ok && loaded.value !== null) {
      expect(loaded.value.retryRun).toBeUndefined();
      expect(loaded.value.lease).toBeUndefined();
      expect(loaded.value.cadence.localTime).toBe('10:00');
    }
  });

  it('returns null when no schedule exists for the user and task type', async () => {
    const repository = createCalendarScheduleRepository();

    const loaded = await repository.getByUserAndTaskType(
      'missing-user',
      'calendar_daily_lookahead'
    );

    expect(loaded).toEqual({ ok: true, value: null });
  });

  it('normalizes malformed stored schedule fields defensively', async () => {
    const repository = createCalendarScheduleRepository();
    fakeFirestore.seedCollection('calendar_schedules', [
      {
        id: 'malformed_calendar_daily_lookahead',
        data: {
          userId: '',
          taskType: 'calendar_daily_lookahead',
          status: 'paused',
          cadence: null,
          payload: null,
          nextRunAt: 456,
          lastRunAt: 789,
          lastRunLocalDate: false,
          createdAt: null,
          updatedAt: null,
          lease: { ownerId: 123, expiresAt: false },
        },
      },
    ]);

    const loaded = await repository.getByUserAndTaskType('', 'calendar_daily_lookahead');

    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toMatchObject({
        id: 'malformed_calendar_daily_lookahead',
        userId: '',
        status: 'paused',
        cadence: { type: 'daily', localTime: '', timeZone: '' },
        payload: {
          prompt: '',
          target: 'intex_agent',
        },
        nextRunAt: '',
        lease: { ownerId: '', expiresAt: '' },
      });
    }
  });

  it('normalizes malformed due schedule identity and retry fields defensively', async () => {
    const repository = createCalendarScheduleRepository();
    fakeFirestore.seedCollection('calendar_schedules', [
      {
        id: 'malformed_due_calendar_daily_lookahead',
        data: {
          userId: 123,
          taskType: 'calendar_daily_lookahead',
          status: 'active',
          cadence: { localTime: '09:15', timeZone: 'America/New_York' },
          payload: {
            prompt: 'Send me events that they have in the calendar in the next 24 hours.',
          },
          nextRunAt: '2026-07-04T13:15:00.000Z',
          retryRun: {
            localDate: false,
            scheduledFor: 456,
          },
        },
      },
    ]);

    const claim = await repository.claimDueSchedules({
      now: '2026-07-04T13:15:00.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });

    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.value[0]?.schedule).toMatchObject({
        id: 'malformed_due_calendar_daily_lookahead',
        userId: '',
        retryRun: {
          localDate: '',
          scheduledFor: '',
        },
      });
    }
  });

  it('does not claim schedules that became inactive or not yet due before the transaction', async () => {
    const repository = createCalendarScheduleRepository();
    fakeFirestore.seedCollection('calendar_schedules', [
      {
        id: 'paused_calendar_daily_lookahead',
        data: schedule({
          id: 'paused_calendar_daily_lookahead',
          userId: 'paused',
          status: 'paused',
        }),
      },
      {
        id: 'future_calendar_daily_lookahead',
        data: schedule({
          id: 'future_calendar_daily_lookahead',
          userId: 'future',
          nextRunAt: '2026-07-04T13:16:00.000Z',
        }),
      },
    ]);

    const claim = await repository.claimDueSchedules({
      now: '2026-07-04T13:15:00.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });

    expect(claim).toEqual({ ok: true, value: [] });
  });

  it('claims due schedules with a lease and does not reclaim while the lease is active', async () => {
    const repository = createCalendarScheduleRepository();

    await repository.upsert(schedule());

    const firstClaim = await repository.claimDueSchedules({
      now: '2026-07-04T13:15:00.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });

    expect(firstClaim.ok).toBe(true);
    if (firstClaim.ok) {
      expect(firstClaim.value).toHaveLength(1);
      expect(firstClaim.value[0]).toMatchObject({
        localDate: '2026-07-04',
        scheduledFor: '2026-07-04T13:15:00.000Z',
      });
    }

    const secondClaim = await repository.claimDueSchedules({
      now: '2026-07-04T13:15:30.000Z',
      limit: 10,
      leaseOwnerId: 'worker-b',
      leaseDurationMs: 60_000,
    });

    expect(secondClaim.ok).toBe(true);
    if (secondClaim.ok) {
      expect(secondClaim.value).toHaveLength(0);
    }
  });

  it('reclaims a due schedule after the lease expires', async () => {
    const repository = createCalendarScheduleRepository();

    await repository.upsert(schedule({
      lease: { ownerId: 'worker-a', expiresAt: '2026-07-04T13:15:10.000Z' },
    }));

    const claim = await repository.claimDueSchedules({
      now: '2026-07-04T13:16:00.000Z',
      limit: 10,
      leaseOwnerId: 'worker-b',
      leaseDurationMs: 60_000,
    });

    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.value).toHaveLength(1);
    }
  });

  it('records sent runs and updates the schedule cursor', async () => {
    const repository = createCalendarScheduleRepository();
    await repository.upsert(schedule());

    const claim = await repository.claimDueSchedules({
      now: '2026-07-04T13:15:00.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;

    await repository.markRunSent({
      scheduleId: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      localDate: '2026-07-04',
      scheduledFor: '2026-07-04T13:15:00.000Z',
      startedAt: claim.value[0]?.startedAt ?? '2026-07-04T13:15:00.000Z',
      finishedAt: '2026-07-04T13:15:05.000Z',
      matrixEventId: '$event-1',
      nextRunAt: '2026-07-05T13:15:00.000Z',
    });

    const loaded = await repository.getByUserAndTaskType('user-123', 'calendar_daily_lookahead');
    expect(loaded.ok).toBe(true);
    if (loaded.ok && loaded.value !== null) {
      expect(loaded.value.lastRunLocalDate).toBe('2026-07-04');
      expect(loaded.value.nextRunAt).toBe('2026-07-05T13:15:00.000Z');
    }
  });

  it('records failed runs and prevents duplicate local-date sends', async () => {
    const repository = createCalendarScheduleRepository();
    await repository.upsert(schedule());

    await repository.markRunFailed({
      scheduleId: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      localDate: '2026-07-04',
      scheduledFor: '2026-07-04T13:15:00.000Z',
      startedAt: '2026-07-04T13:15:00.000Z',
      finishedAt: '2026-07-04T13:15:05.000Z',
      error: 'Matrix outbound mapping missing',
      retryable: false,
      nextRunAt: '2026-07-05T13:15:00.000Z',
    });

    const claim = await repository.claimDueSchedules({
      now: '2026-07-04T13:15:10.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });

    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.value).toHaveLength(0);
    }
  });

  it('reclaims retryable failed runs for the same local date', async () => {
    const repository = createCalendarScheduleRepository();
    await repository.upsert(schedule());

    await repository.markRunFailed({
      scheduleId: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      localDate: '2026-07-04',
      scheduledFor: '2026-07-04T13:15:00.000Z',
      startedAt: '2026-07-04T13:15:00.000Z',
      finishedAt: '2026-07-04T13:15:05.000Z',
      error: 'socket hang up',
      retryable: true,
      nextRunAt: '2026-07-04T13:30:00.000Z',
    });

    const claim = await repository.claimDueSchedules({
      now: '2026-07-04T13:30:00.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });

    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.value).toHaveLength(1);
      expect(claim.value[0]).toMatchObject({
        localDate: '2026-07-04',
        scheduledFor: '2026-07-04T13:15:00.000Z',
      });
    }
  });

  it('preserves retry local date when the retry crosses local midnight', async () => {
    const repository = createCalendarScheduleRepository();
    await repository.upsert(
      schedule({
        cadence: { type: 'daily', localTime: '23:50', timeZone: 'America/New_York' },
        nextRunAt: '2026-07-05T03:50:00.000Z',
      })
    );

    await repository.markRunFailed({
      scheduleId: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      localDate: '2026-07-04',
      scheduledFor: '2026-07-05T03:50:00.000Z',
      startedAt: '2026-07-05T03:50:00.000Z',
      finishedAt: '2026-07-05T03:50:05.000Z',
      error: 'socket hang up',
      retryable: true,
      nextRunAt: '2026-07-05T04:05:00.000Z',
    });

    const claim = await repository.claimDueSchedules({
      now: '2026-07-05T04:05:00.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });

    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.value).toHaveLength(1);
      expect(claim.value[0]).toMatchObject({
        localDate: '2026-07-04',
        scheduledFor: '2026-07-05T03:50:00.000Z',
      });
    }
  });

  it('skips duplicate local-date claims when a run already exists', async () => {
    const repository = createCalendarScheduleRepository();
    fakeFirestore.seedCollection('calendar_schedules', [
      { id: 'user-123_calendar_daily_lookahead', data: schedule() },
    ]);
    fakeFirestore.seedCollection('calendar_schedule_runs', [
      {
        id: 'user-123_calendar_daily_lookahead_2026-07-04',
        data: {
          scheduleId: 'user-123_calendar_daily_lookahead',
          userId: 'user-123',
          taskType: 'calendar_daily_lookahead',
          status: 'sent',
          localDate: '2026-07-04',
          scheduledFor: '2026-07-04T13:15:00.000Z',
          startedAt: '2026-07-04T13:15:00.000Z',
        },
      },
    ]);

    const claim = await repository.claimDueSchedules({
      now: '2026-07-04T13:15:10.000Z',
      limit: 10,
      leaseOwnerId: 'worker-a',
      leaseDurationMs: 60_000,
    });

    expect(claim.ok).toBe(true);
    if (claim.ok) {
      expect(claim.value).toHaveLength(0);
    }
    const loaded = await repository.getByUserAndTaskType('user-123', 'calendar_daily_lookahead');
    expect(loaded.ok).toBe(true);
    if (loaded.ok && loaded.value !== null) {
      expect(loaded.value.lastRunLocalDate).toBe('2026-07-04');
      expect(loaded.value.nextRunAt).toBe('2026-07-05T13:15:00.000Z');
    }
  });

  it('returns errors when marking sent or failed runs cannot write', async () => {
    const repository = createCalendarScheduleRepository();
    fakeFirestore.configure({ errorToThrow: new Error('firestore unavailable') });

    const sent = await repository.markRunSent({
      scheduleId: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      localDate: '2026-07-04',
      scheduledFor: '2026-07-04T13:15:00.000Z',
      startedAt: '2026-07-04T13:15:00.000Z',
      finishedAt: '2026-07-04T13:15:05.000Z',
      matrixEventId: '$event-1',
      nextRunAt: '2026-07-05T13:15:00.000Z',
    });
    const failed = await repository.markRunFailed({
      scheduleId: 'user-123_calendar_daily_lookahead',
      userId: 'user-123',
      taskType: 'calendar_daily_lookahead',
      localDate: '2026-07-04',
      scheduledFor: '2026-07-04T13:15:00.000Z',
      startedAt: '2026-07-04T13:15:00.000Z',
      finishedAt: '2026-07-04T13:15:05.000Z',
      error: 'Matrix setup required',
      retryable: false,
      nextRunAt: '2026-07-05T13:15:00.000Z',
    });

    expect(sent.ok).toBe(false);
    expect(failed.ok).toBe(false);
  });
});
