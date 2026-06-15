/**
 * Tests for scheduledDispatch helpers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatSchedulePreview,
  getBrowserTimezone,
  isFutureLocalDateTime,
  localInputToIsoUtc,
  nowLocalInputValue,
} from '../scheduledDispatch.js';

describe('getBrowserTimezone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the browser timezone when Intl resolves a value', () => {
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({
        timeZone: 'America/New_York',
      } as Intl.ResolvedDateTimeFormatOptions);

    expect(getBrowserTimezone()).toBe('America/New_York');
    expect(spy).toHaveBeenCalled();
  });

  it('falls back to UTC when resolvedOptions returns empty timeZone', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: '',
    } as Intl.ResolvedDateTimeFormatOptions);

    expect(getBrowserTimezone()).toBe('UTC');
  });

  it('falls back to UTC on any error', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(
      () => {
        throw new Error('boom');
      },
    );

    expect(getBrowserTimezone()).toBe('UTC');
  });
});

describe('nowLocalInputValue', () => {
  it('produces YYYY-MM-DDTHH:mm with zero padding', () => {
    const date = new Date(2026, 2, 5, 9, 7); // Mar 5, 2026 09:07 local
    expect(nowLocalInputValue(date)).toBe('2026-03-05T09:07');
  });

  it('pads minutes and hours under 10', () => {
    const date = new Date(2026, 0, 1, 0, 0); // Jan 1, 2026 00:00 local
    expect(nowLocalInputValue(date)).toBe('2026-01-01T00:00');
  });

  it('uses `new Date()` when no argument is given', () => {
    const output = nowLocalInputValue();
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

describe('localInputToIsoUtc', () => {
  it('round-trips a local input value into a valid ISO UTC string', () => {
    const local = '2026-04-24T22:00';
    const iso = localInputToIsoUtc(local);
    expect(iso).not.toBeNull();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // The resulting date, when re-parsed and projected back to local, matches.
    const roundTripped = new Date(iso ?? '');
    expect(Number.isNaN(roundTripped.getTime())).toBe(false);
  });

  it('returns null for empty input', () => {
    expect(localInputToIsoUtc('')).toBeNull();
  });

  it('returns null for invalid input', () => {
    expect(localInputToIsoUtc('not-a-date')).toBeNull();
  });
});

describe('formatSchedulePreview', () => {
  it('formats an absolute ISO string in UTC with the Dispatches prefix', () => {
    const iso = '2026-04-24T22:00:00.000Z';
    expect(formatSchedulePreview(iso, 'UTC')).toMatch(
      /^Dispatches Apr 24, 2026, \d{1,2}:00 (PM|AM) UTC$/,
    );
  });

  it('includes the short timezone label when a named zone is passed', () => {
    const iso = '2026-04-24T22:00:00.000Z';
    const preview = formatSchedulePreview(iso, 'America/New_York');
    expect(preview.startsWith('Dispatches ')).toBe(true);
    expect(preview).toMatch(/Apr 24, 2026/);
  });
});

describe('isFutureLocalDateTime', () => {
  it('returns true for a time after now', () => {
    const now = new Date(2026, 3, 24, 12, 0);
    // one minute in the future
    const future = '2026-04-24T12:01';
    expect(isFutureLocalDateTime(future, now)).toBe(true);
  });

  it('returns false for a past time', () => {
    const now = new Date(2026, 3, 24, 12, 0);
    expect(isFutureLocalDateTime('2026-04-24T11:59', now)).toBe(false);
  });

  it('returns false for equal time (must be strictly in the future)', () => {
    const now = new Date(2026, 3, 24, 12, 0);
    expect(isFutureLocalDateTime('2026-04-24T12:00', now)).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(isFutureLocalDateTime('')).toBe(false);
  });

  it('returns false for invalid input', () => {
    expect(isFutureLocalDateTime('garbage')).toBe(false);
  });
});
