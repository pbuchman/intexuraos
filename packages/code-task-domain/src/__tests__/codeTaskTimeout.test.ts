import { describe, it, expect } from 'vitest';
import {
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
  DEFAULT_TIMEOUT_HOURS,
  isValidTimeoutHours,
  timeoutHoursToMs,
} from '../codeTaskTimeout.js';

describe('codeTaskTimeout', () => {
  it('exposes expected bounds', () => {
    expect(MIN_TIMEOUT_HOURS).toBe(1);
    expect(MAX_TIMEOUT_HOURS).toBe(12);
    expect(DEFAULT_TIMEOUT_HOURS).toBe(5);
  });

  it('isValidTimeoutHours accepts integers in [1,12]', () => {
    expect(isValidTimeoutHours(1)).toBe(true);
    expect(isValidTimeoutHours(5)).toBe(true);
    expect(isValidTimeoutHours(12)).toBe(true);
  });

  it('isValidTimeoutHours rejects out-of-range, non-integers, NaN, non-number', () => {
    expect(isValidTimeoutHours(0)).toBe(false);
    expect(isValidTimeoutHours(13)).toBe(false);
    expect(isValidTimeoutHours(5.5)).toBe(false);
    expect(isValidTimeoutHours(Number.NaN)).toBe(false);
    expect(isValidTimeoutHours(-1)).toBe(false);
    expect(isValidTimeoutHours('5')).toBe(false);
    expect(isValidTimeoutHours(null)).toBe(false);
    expect(isValidTimeoutHours(undefined)).toBe(false);
  });

  it('timeoutHoursToMs converts hours to milliseconds', () => {
    expect(timeoutHoursToMs(1)).toBe(3_600_000);
    expect(timeoutHoursToMs(5)).toBe(18_000_000);
    expect(timeoutHoursToMs(12)).toBe(43_200_000);
  });
});
