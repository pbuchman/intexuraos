import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveTimeRange } from '../llmUsageTimeRange.js';

describe('resolveTimeRange', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves 'today' to start of current day to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T14:30:00.000Z'));

    const result = resolveTimeRange({ preset: 'today' });

    expect(result.from).toBe(new Date('2026-04-10T00:00:00.000Z').toISOString());
    expect(result.to).toBe('2026-04-10T14:30:00.000Z');
  });

  it("resolves 'yesterday' to start of previous day to end of previous day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T14:30:00.000Z'));

    const result = resolveTimeRange({ preset: 'yesterday' });

    expect(result.from).toBe(new Date('2026-04-09T00:00:00.000Z').toISOString());
    expect(result.to).toBe(new Date('2026-04-09T23:59:59.999Z').toISOString());
  });

  it("resolves 'last7days' to 7 days ago to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T14:30:00.000Z'));

    const result = resolveTimeRange({ preset: 'last7days' });

    expect(result.from).toBe('2026-04-03T14:30:00.000Z');
    expect(result.to).toBe('2026-04-10T14:30:00.000Z');
  });

  it("resolves 'last30days' to 30 days ago to now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T14:30:00.000Z'));

    const result = resolveTimeRange({ preset: 'last30days' });

    expect(result.from).toBe('2026-03-11T14:30:00.000Z');
    expect(result.to).toBe('2026-04-10T14:30:00.000Z');
  });

  it("resolves 'custom' with customFrom/customTo", () => {
    const result = resolveTimeRange({
      preset: 'custom',
      customFrom: '2026-01-01T00:00:00Z',
      customTo: '2026-01-31T23:59:59Z',
    });

    expect(result.from).toBe('2026-01-01T00:00:00Z');
    expect(result.to).toBe('2026-01-31T23:59:59Z');
  });

  it("resolves 'custom' with missing customFrom/customTo to empty strings", () => {
    const result = resolveTimeRange({ preset: 'custom' });

    expect(result.from).toBe('');
    expect(result.to).toBe('');
  });
});
