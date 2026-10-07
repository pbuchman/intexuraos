import { describe, expect, it, vi } from 'vitest';
import { resolveBuildDate } from '../buildMetadata.js';

describe('resolveBuildDate', () => {
  it('renders a reproducible timestamp from SOURCE_DATE_EPOCH', () => {
    expect(resolveBuildDate('1735689600')).toBe('2025-01-01T00:00:00.000Z');
    expect(resolveBuildDate('1735689600')).toBe('2025-01-01T00:00:00.000Z');
  });

  it('rejects malformed reproducible timestamps', () => {
    expect(() => resolveBuildDate('1.5')).toThrow(/non-negative integer/u);
    expect(() => resolveBuildDate('-1')).toThrow(/non-negative integer/u);
  });

  it('uses wall-clock time for ordinary local builds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    expect(resolveBuildDate(undefined)).toBe('2026-01-02T03:04:05.000Z');
    vi.useRealTimers();
  });
});
