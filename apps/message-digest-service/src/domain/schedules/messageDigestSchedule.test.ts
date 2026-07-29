import { describe, expect, it, vi } from 'vitest';
import {
  getDailyMessageDigestBoundaryAtOrBefore,
  getManualMessageDigestBoundary,
  getMessageDigestBoundaryAtOrBefore,
  getMessageDigestLocalDateRange,
  getNextMessageDigestBoundary,
  getNextDailyMessageDigestBoundary,
  previewMessageDigestSchedule,
  previewDailyMessageDigestSchedule,
  type DailyMessageDigestSchedule,
  type MessageDigestSchedule,
  type MessageDigestWeekday,
} from './messageDigestSchedule.js';

const utcSchedule: DailyMessageDigestSchedule = {
  kind: 'daily',
  localTime: '09:00',
  timeZone: 'UTC',
};

describe('daily Message Digest schedule', () => {
  it('returns the immediately preceding and exact next calendar boundaries', () => {
    expect(
      previewDailyMessageDigestSchedule({
        schedule: utcSchedule,
        evaluatedAt: '2026-07-27T12:00:00.000Z',
      })
    ).toEqual({
      ok: true,
      value: {
        evaluatedAt: '2026-07-27T12:00:00.000Z',
        precedingBoundary: '2026-07-27T09:00:00.000Z',
        nextBoundary: '2026-07-28T09:00:00.000Z',
        timeZone: 'UTC',
      },
    });
  });

  it('treats a cadence boundary as preceding and keeps next strictly later', () => {
    expect(
      getDailyMessageDigestBoundaryAtOrBefore(utcSchedule, '2026-07-27T09:00:00.000Z')
    ).toEqual({ ok: true, value: '2026-07-27T09:00:00.000Z' });
    expect(getNextDailyMessageDigestBoundary(utcSchedule, '2026-07-27T09:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-07-28T09:00:00.000Z',
    });
  });

  it('uses the invocation instant as a manual boundary and advances to the first later cadence', () => {
    expect(getManualMessageDigestBoundary(utcSchedule, '2026-07-27T12:34:56.000Z')).toEqual({
      ok: true,
      value: {
        manualBoundary: '2026-07-27T12:34:56.000Z',
        nextBoundary: '2026-07-28T09:00:00.000Z',
      },
    });
  });

  it.each(['9:00', '24:00', '09:60', '09:00:00', ''])(
    'rejects invalid local time %j',
    (localTime) => {
      expect(
        previewDailyMessageDigestSchedule({
          schedule: { ...utcSchedule, localTime },
          evaluatedAt: '2026-07-27T12:00:00.000Z',
        })
      ).toEqual({
        ok: false,
        error: { code: 'INVALID_LOCAL_TIME', message: 'Invalid daily local time' },
      });
    }
  );

  it('rejects an invalid IANA time zone and invalid evaluation instant', () => {
    expect(
      getNextDailyMessageDigestBoundary(
        { ...utcSchedule, timeZone: 'Not/A_Real_Zone' },
        '2026-07-27T12:00:00.000Z'
      )
    ).toEqual({
      ok: false,
      error: { code: 'INVALID_TIME_ZONE', message: 'Invalid daily time zone' },
    });
    expect(getNextDailyMessageDigestBoundary(utcSchedule, 'not-an-instant')).toEqual({
      ok: false,
      error: { code: 'INVALID_INSTANT', message: 'Invalid schedule instant' },
    });
  });

  it('maps the same Warsaw local time to different winter and summer UTC instants', () => {
    const warsaw = warsawSchedule();

    expect(getDailyMessageDigestBoundaryAtOrBefore(warsaw, '2026-01-15T12:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-01-15T02:00:00.000Z',
    });
    expect(getDailyMessageDigestBoundaryAtOrBefore(warsaw, '2026-07-15T12:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-07-15T01:00:00.000Z',
    });
  });

  it('creates a 23-hour Warsaw source window across spring-forward', () => {
    const warsaw = warsawSchedule();
    const before = successfulBoundary(
      getDailyMessageDigestBoundaryAtOrBefore(warsaw, '2026-03-28T12:00:00.000Z')
    );
    const after = successfulBoundary(
      getDailyMessageDigestBoundaryAtOrBefore(warsaw, '2026-03-29T12:00:00.000Z')
    );

    expect(before).toBe('2026-03-28T02:00:00.000Z');
    expect(after).toBe('2026-03-29T01:00:00.000Z');
    expect(Date.parse(after) - Date.parse(before)).toBe(23 * 60 * 60 * 1000);
  });

  it('creates a 25-hour Warsaw source window across fall-back', () => {
    const warsaw = warsawSchedule();
    const before = successfulBoundary(
      getDailyMessageDigestBoundaryAtOrBefore(warsaw, '2026-10-24T12:00:00.000Z')
    );
    const after = successfulBoundary(
      getDailyMessageDigestBoundaryAtOrBefore(warsaw, '2026-10-25T12:00:00.000Z')
    );

    expect(before).toBe('2026-10-24T01:00:00.000Z');
    expect(after).toBe('2026-10-25T02:00:00.000Z');
    expect(Date.parse(after) - Date.parse(before)).toBe(25 * 60 * 60 * 1000);
  });

  it('converts inclusive local history dates to exact DST-aware half-open instants', () => {
    expect(
      getMessageDigestLocalDateRange({
        timeZone: 'Europe/Warsaw',
        fromDate: '2026-03-29',
        toDate: '2026-03-29',
      })
    ).toEqual({
      ok: true,
      value: {
        fromInclusive: '2026-03-28T23:00:00.000Z',
        toExclusive: '2026-03-29T22:00:00.000Z',
      },
    });
    expect(
      getMessageDigestLocalDateRange({
        timeZone: 'Europe/Warsaw',
        fromDate: '2026-10-25',
        toDate: '2026-10-25',
      })
    ).toEqual({
      ok: true,
      value: {
        fromInclusive: '2026-10-24T22:00:00.000Z',
        toExclusive: '2026-10-25T23:00:00.000Z',
      },
    });
  });

  it('rejects impossible or reversed local history date ranges', () => {
    expect(
      getMessageDigestLocalDateRange({
        timeZone: 'Europe/Warsaw',
        fromDate: '2026-02-30',
        toDate: '2026-03-01',
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_LOCAL_DATE' } });
    expect(
      getMessageDigestLocalDateRange({
        timeZone: 'Europe/Warsaw',
        fromDate: '2026-07-28',
        toDate: '2026-07-27',
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_LOCAL_DATE' } });
  });

  it('rejects invalid date-range time zones and malformed dates on either boundary', () => {
    expect(
      getMessageDigestLocalDateRange({
        timeZone: 'Not/A_Real_Zone',
        fromDate: '2026-07-27',
        toDate: '2026-07-27',
      })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_TIME_ZONE' } });
    for (const [fromDate, toDate] of [
      ['not-a-date', '2026-07-27'],
      ['2026-07-27', 'not-a-date'],
    ] as const) {
      expect(
        getMessageDigestLocalDateRange({ timeZone: 'UTC', fromDate, toDate })
      ).toMatchObject({ ok: false, error: { code: 'INVALID_LOCAL_DATE' } });
    }
  });

  it('uses the previous boundary before send time and the same-day next boundary', () => {
    expect(
      getDailyMessageDigestBoundaryAtOrBefore(utcSchedule, '2026-07-27T08:00:00.000Z')
    ).toEqual({ ok: true, value: '2026-07-26T09:00:00.000Z' });
    expect(getNextDailyMessageDigestBoundary(utcSchedule, '2026-07-27T08:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-07-27T09:00:00.000Z',
    });
  });

  it('propagates invalid manual schedule input without producing a boundary', () => {
    expect(
      getManualMessageDigestBoundary(
        { ...utcSchedule, localTime: 'invalid' },
        '2026-07-27T08:00:00.000Z'
      )
    ).toMatchObject({ ok: false, error: { code: 'INVALID_LOCAL_TIME' } });
  });

  it('propagates a next-boundary validation failure when a mutable input changes between reads', () => {
    let evaluatedAtReads = 0;
    const input = {
      schedule: utcSchedule,
      get evaluatedAt(): string {
        evaluatedAtReads += 1;
        return evaluatedAtReads === 1 ? '2026-07-27T12:00:00.000Z' : 'not-an-instant';
      },
    };

    expect(previewMessageDigestSchedule(input)).toEqual({
      ok: false,
      error: { code: 'INVALID_INSTANT', message: 'Invalid schedule instant' },
    });
  });

  it('advances a nonexistent DST wall time to the first valid instant that day', () => {
    const nonexistent: DailyMessageDigestSchedule = {
      kind: 'daily',
      localTime: '02:30',
      timeZone: 'Europe/Warsaw',
    };

    expect(
      getDailyMessageDigestBoundaryAtOrBefore(nonexistent, '2026-03-29T12:00:00.000Z')
    ).toEqual({ ok: true, value: '2026-03-29T01:00:00.000Z' });
  });

  it('uses and validates the defensive local-boundary projection fallback', () => {
    const formatToParts = vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts');
    try {
      let calls = 0;
      formatToParts.mockImplementation((instant) => {
        calls += 1;
        const date = instant instanceof Date ? instant : new Date(instant ?? 0);
        return fixedDateTimeParts(calls === 1 ? 12 : 10 + (date.getUTCHours() % 2));
      });
      expect(
        getMessageDigestBoundaryAtOrBefore(utcSchedule, '2026-07-27T23:00:00.000Z')
      ).toMatchObject({ ok: true });

      calls = 0;
      formatToParts.mockImplementation(() => {
        calls += 1;
        return calls === 1
          ? fixedDateTimeParts(12)
          : fixedDateTimeParts(23, '2026-07-26');
      });
      expect(() =>
        getMessageDigestBoundaryAtOrBefore(utcSchedule, '2026-07-27T23:00:00.000Z')
      ).toThrow('Unable to resolve daily Message Digest boundary');
    } finally {
      formatToParts.mockRestore();
    }
  });

  it('fails explicitly when a mutable weekly cadence stops matching every bounded date', () => {
    const mutableWeekly = (): MessageDigestSchedule => {
      let weekdayReads = 0;
      return {
        kind: 'weekly',
        get weekday(): MessageDigestWeekday {
          weekdayReads += 1;
          return weekdayReads === 1 ? 'monday' : ('never' as MessageDigestWeekday);
        },
        localTime: '09:00',
        timeZone: 'UTC',
      };
    };

    expect(() =>
      getMessageDigestBoundaryAtOrBefore(mutableWeekly(), '2026-07-27T12:00:00.000Z')
    ).toThrow('Unable to resolve preceding Message Digest boundary');
    expect(() =>
      getNextMessageDigestBoundary(mutableWeekly(), '2026-07-27T12:00:00.000Z')
    ).toThrow('Unable to resolve next Message Digest boundary');
  });
});

describe('complete Message Digest calendar schedule', () => {
  it.each([
    ['monday', '2026-07-27T09:00:00.000Z'],
    ['tuesday', '2026-07-28T09:00:00.000Z'],
    ['wednesday', '2026-07-29T09:00:00.000Z'],
    ['thursday', '2026-07-30T09:00:00.000Z'],
    ['friday', '2026-07-31T09:00:00.000Z'],
    ['saturday', '2026-08-01T09:00:00.000Z'],
    ['sunday', '2026-08-02T09:00:00.000Z'],
  ] as const)('selects the next %s boundary for a weekly schedule', (weekday, expected) => {
    expect(
      getNextMessageDigestBoundary(
        { kind: 'weekly', weekday, localTime: '09:00', timeZone: 'UTC' },
        '2026-07-26T12:00:00.000Z'
      )
    ).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['2026-07-27T12:00:00.000Z', '2026-07-27T09:00:00.000Z'],
    ['2026-07-28T12:00:00.000Z', '2026-07-28T09:00:00.000Z'],
    ['2026-07-29T12:00:00.000Z', '2026-07-29T09:00:00.000Z'],
    ['2026-07-30T12:00:00.000Z', '2026-07-30T09:00:00.000Z'],
    ['2026-07-31T12:00:00.000Z', '2026-07-31T09:00:00.000Z'],
  ] as const)('runs on each weekday at %s', (evaluatedAt, expected) => {
    expect(getMessageDigestBoundaryAtOrBefore(weekdaysUtc(), evaluatedAt)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it('skips both weekend days in either direction', () => {
    expect(
      getMessageDigestBoundaryAtOrBefore(weekdaysUtc(), '2026-08-02T12:00:00.000Z')
    ).toEqual({ ok: true, value: '2026-07-31T09:00:00.000Z' });
    expect(getNextMessageDigestBoundary(weekdaysUtc(), '2026-07-31T09:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-08-03T09:00:00.000Z',
    });
  });

  it('provides the first surrounding weekly boundaries before the selected weekday', () => {
    const weekly: MessageDigestSchedule = {
      kind: 'weekly',
      weekday: 'wednesday',
      localTime: '09:00',
      timeZone: 'UTC',
    };

    expect(
      previewMessageDigestSchedule({
        schedule: weekly,
        evaluatedAt: '2026-07-27T12:00:00.000Z',
      })
    ).toEqual({
      ok: true,
      value: {
        evaluatedAt: '2026-07-27T12:00:00.000Z',
        precedingBoundary: '2026-07-22T09:00:00.000Z',
        nextBoundary: '2026-07-29T09:00:00.000Z',
        timeZone: 'UTC',
      },
    });
  });

  it('advances one missed cadence at a time from a historical boundary', () => {
    const weekly: MessageDigestSchedule = {
      kind: 'weekly',
      weekday: 'monday',
      localTime: '09:00',
      timeZone: 'UTC',
    };

    expect(getNextMessageDigestBoundary(weekly, '2026-07-06T09:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-07-13T09:00:00.000Z',
    });
    expect(getNextMessageDigestBoundary(weekly, '2026-07-13T09:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-07-20T09:00:00.000Z',
    });
  });

  it('computes resume as the first eligible boundary strictly after now', () => {
    expect(getNextMessageDigestBoundary(weekdaysUtc(), '2026-07-31T08:59:59.000Z')).toEqual({
      ok: true,
      value: '2026-07-31T09:00:00.000Z',
    });
    expect(getNextMessageDigestBoundary(weekdaysUtc(), '2026-07-31T09:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-08-03T09:00:00.000Z',
    });
  });

  it('keeps weekly Warsaw wall time stable in winter and summer', () => {
    const weekly: MessageDigestSchedule = {
      kind: 'weekly',
      weekday: 'thursday',
      localTime: '03:00',
      timeZone: 'Europe/Warsaw',
    };

    expect(getMessageDigestBoundaryAtOrBefore(weekly, '2026-01-15T12:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-01-15T02:00:00.000Z',
    });
    expect(getMessageDigestBoundaryAtOrBefore(weekly, '2026-07-16T12:00:00.000Z')).toEqual({
      ok: true,
      value: '2026-07-16T01:00:00.000Z',
    });
  });

  it('uses the first valid spring instant and earlier autumn occurrence when cadence includes Sunday', () => {
    for (const schedule of schedulesAtWarsaw0230()) {
      expect(
        getMessageDigestBoundaryAtOrBefore(schedule, '2026-03-29T12:00:00.000Z')
      ).toEqual({ ok: true, value: '2026-03-29T01:00:00.000Z' });
      expect(
        getMessageDigestBoundaryAtOrBefore(schedule, '2026-10-25T12:00:00.000Z')
      ).toEqual({ ok: true, value: '2026-10-25T00:30:00.000Z' });
      expect(getNextMessageDigestBoundary(schedule, '2026-10-25T00:45:00.000Z')).toEqual({
        ok: true,
        value:
          schedule.kind === 'weekly'
            ? '2026-11-01T01:30:00.000Z'
            : '2026-10-26T01:30:00.000Z',
      });
    }
  });

  it.each([
    [{ kind: 'hourly', localTime: '09:00', timeZone: 'UTC' }, 'INVALID_SCHEDULE_KIND'],
    [
      { kind: 'weekly', weekday: 'funday', localTime: '09:00', timeZone: 'UTC' },
      'INVALID_WEEKDAY',
    ],
    [{ kind: 'weekly', localTime: '09:00', timeZone: 'UTC' }, 'INVALID_WEEKDAY'],
  ] as const)('rejects invalid cadence value %#', (schedule, code) => {
    expect(
      getNextMessageDigestBoundary(
        schedule as unknown as MessageDigestSchedule,
        '2026-07-27T12:00:00.000Z'
      )
    ).toMatchObject({ ok: false, error: { code } });
  });
});

function warsawSchedule(): DailyMessageDigestSchedule {
  return { kind: 'daily', localTime: '03:00', timeZone: 'Europe/Warsaw' };
}

function weekdaysUtc(): MessageDigestSchedule {
  return { kind: 'weekdays', localTime: '09:00', timeZone: 'UTC' };
}

function schedulesAtWarsaw0230(): MessageDigestSchedule[] {
  const common = { localTime: '02:30', timeZone: 'Europe/Warsaw' } as const;
  return [
    { kind: 'daily', ...common },
    { kind: 'weekly', weekday: 'sunday', ...common },
  ];
}

const _allWeekdaysCompileCheck: readonly MessageDigestWeekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];
void _allWeekdaysCompileCheck;

function successfulBoundary(
  result: ReturnType<typeof getDailyMessageDigestBoundaryAtOrBefore>
): string {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function fixedDateTimeParts(hour: number, date = '2026-07-27'): Intl.DateTimeFormatPart[] {
  const [year, month, day] = date.split('-') as [string, string, string];
  return [
    { type: 'year', value: year },
    { type: 'month', value: month },
    { type: 'day', value: day },
    { type: 'hour', value: String(hour).padStart(2, '0') },
    { type: 'minute', value: '00' },
    { type: 'second', value: '00' },
  ];
}
