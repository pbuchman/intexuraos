import { describe, expect, it, vi, afterEach } from 'vitest';
import { yesterdayCet } from '../../../domain/usecases/yesterdayCet.js';

describe('yesterdayCet', () => {
  afterEach(() => vi.useRealTimers());

  it('returns previous CET date when run at 02:00 CET in winter (UTC=01:00)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T01:00:00Z')); // 02:00 CET
    expect(yesterdayCet()).toBe('2026-01-14');
  });

  it('returns previous CET date when run at 03:00 CEST in summer (UTC=01:00)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T01:00:00Z')); // 03:00 CEST
    expect(yesterdayCet()).toBe('2026-07-14');
  });

  it('handles month boundary correctly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T01:00:00Z')); // 03:00 CEST
    expect(yesterdayCet()).toBe('2026-04-30');
  });
});
