import { describe, expect, it } from 'vitest';
import {
  getSessionTimestampMs,
  normalizeSessionTimestamp,
} from '../../domain/sessions/sessionTimestamps.js';

describe('session timestamp helpers', () => {
  it('keeps ISO timestamps normalized as ISO strings', () => {
    const timestamp = '2026-06-24T16:10:16.000Z';

    expect(normalizeSessionTimestamp(timestamp)).toBe(timestamp);
    expect(getSessionTimestampMs(timestamp)).toBe(Date.parse(timestamp));
  });

  it('normalizes epoch-second timestamps from WhatsApp', () => {
    expect(normalizeSessionTimestamp('1782317416')).toBe('2026-06-24T16:10:16.000Z');
    expect(getSessionTimestampMs('1782317416')).toBe(Date.parse('2026-06-24T16:10:16.000Z'));
  });

  it('normalizes epoch-millisecond timestamps', () => {
    expect(normalizeSessionTimestamp('1782317416000')).toBe('2026-06-24T16:10:16.000Z');
    expect(getSessionTimestampMs('1782317416000')).toBe(Date.parse('2026-06-24T16:10:16.000Z'));
  });

  it('preserves invalid timestamp strings and reports NaN milliseconds', () => {
    expect(normalizeSessionTimestamp('')).toBe('');
    expect(getSessionTimestampMs('')).toBeNaN();
    expect(normalizeSessionTimestamp('not-a-date')).toBe('not-a-date');
    expect(getSessionTimestampMs('not-a-date')).toBeNaN();
  });

  it('does not treat unsafe numeric strings as valid epoch values', () => {
    const unsafeEpoch = '9007199254740992';

    expect(normalizeSessionTimestamp(unsafeEpoch)).toBe(unsafeEpoch);
    expect(getSessionTimestampMs(unsafeEpoch)).toBeNaN();
  });

  it('rejects numeric timestamps outside the JavaScript date range', () => {
    const outOfRangeEpoch = '9007199254740991';

    expect(normalizeSessionTimestamp(outOfRangeEpoch)).toBe(outOfRangeEpoch);
    expect(getSessionTimestampMs(outOfRangeEpoch)).toBeNaN();
  });
});
