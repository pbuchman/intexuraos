import { describe, expect, it } from 'vitest';
import {
  calculateNextDailyRunAfterLocalDate,
  calculateNextScheduleRunAt,
  getLocalDateInTimeZone,
  validateScheduleCadence,
} from '../../../domain/schedules/scheduleTime.js';

describe('scheduleTime', () => {
  it('accepts HH:mm values on 15-minute boundaries in an IANA time zone', () => {
    const result = validateScheduleCadence({
      localTime: '09:15',
      timeZone: 'America/New_York',
    });

    expect(result.ok).toBe(true);
  });

  it('rejects local times outside 15-minute increments', () => {
    const result = validateScheduleCadence({
      localTime: '09:10',
      timeZone: 'America/New_York',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('15-minute');
    }
  });

  it('rejects malformed local times', () => {
    const result = validateScheduleCadence({
      localTime: '24:00',
      timeZone: 'America/New_York',
    });

    expect(result.ok).toBe(false);
  });

  it('rejects invalid IANA time zones', () => {
    const result = validateScheduleCadence({
      localTime: '09:15',
      timeZone: 'Mars/Olympus',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('timezone');
    }
  });

  it('calculates the next same-day run when the local time has not passed yet', () => {
    const result = calculateNextScheduleRunAt({
      localTime: '09:15',
      timeZone: 'America/New_York',
      now: '2026-07-04T12:00:00.000Z',
    });

    expect(result).toBe('2026-07-04T13:15:00.000Z');
  });

  it('calculates the next-day run when the local time already passed', () => {
    const result = calculateNextScheduleRunAt({
      localTime: '09:15',
      timeZone: 'America/New_York',
      now: '2026-07-04T14:30:00.000Z',
    });

    expect(result).toBe('2026-07-05T13:15:00.000Z');
  });

  it('advances to the next local day when the current local date already ran', () => {
    const result = calculateNextScheduleRunAt({
      localTime: '09:15',
      timeZone: 'America/New_York',
      now: '2026-07-04T13:16:00.000Z',
      lastRunLocalDate: '2026-07-04',
    });

    expect(result).toBe('2026-07-05T13:15:00.000Z');
  });

  it('formats the local date for a zoned instant', () => {
    expect(getLocalDateInTimeZone('2026-07-04T13:15:00.000Z', 'America/New_York')).toBe(
      '2026-07-04'
    );
  });

  it('calculates the next daily run after a completed local date', () => {
    expect(
      calculateNextDailyRunAfterLocalDate(
        '2026-07-04',
        '09:15',
        'America/New_York'
      )
    ).toBe('2026-07-05T13:15:00.000Z');
  });

  it('throws when next-run calculation receives an invalid local time', () => {
    expect(() =>
      calculateNextScheduleRunAt({
        localTime: '09:10',
        timeZone: 'America/New_York',
        now: '2026-07-04T12:00:00.000Z',
      })
    ).toThrow('Invalid local time');
  });

  it('preserves correct dates across a western timezone local-day boundary', () => {
    expect(getLocalDateInTimeZone('2026-07-04T02:30:00.000Z', 'America/Los_Angeles')).toBe(
      '2026-07-03'
    );
  });
});
