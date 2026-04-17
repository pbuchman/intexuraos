import { describe, it, expect } from 'vitest';
import { computeActiveFilters } from '../activeFilters.js';
import type { TimeRangeState } from '@/utils/llmUsageTimeRange';

const DEFAULT_TIME_RANGE: TimeRangeState = { preset: 'last7days' };

describe('computeActiveFilters', () => {
  it('returns zero active filters when everything matches defaults', () => {
    const result = computeActiveFilters({
      timeRange: DEFAULT_TIME_RANGE,
      filters: {},
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(result.count).toBe(0);
    expect(result.chips).toEqual([
      { key: 'timeRange', label: 'Last 7d', tone: 'neutral' },
    ]);
  });

  it('counts a non-default time range preset', () => {
    const r = computeActiveFilters({
      timeRange: { preset: 'today' },
      filters: {},
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(r.count).toBe(1);
    expect(r.chips).toEqual([{ key: 'timeRange', label: 'Today', tone: 'active' }]);
  });

  it('counts each active provider as a chip but a single +1 on count', () => {
    const r = computeActiveFilters({
      timeRange: DEFAULT_TIME_RANGE,
      filters: { providers: ['anthropic', 'openai'] },
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(r.count).toBe(1);
    expect(r.chips.some((c) => c.key === 'provider:anthropic')).toBe(true);
    expect(r.chips.some((c) => c.key === 'provider:openai')).toBe(true);
  });

  it('counts groupBy and sort changes', () => {
    const r = computeActiveFilters({
      timeRange: DEFAULT_TIME_RANGE,
      filters: {},
      groupBy: 'day',
      sortBy: { field: 'occurredAt', direction: 'asc' },
    });
    expect(r.count).toBe(2);
    expect(r.chips.some((c) => c.key === 'groupBy' && c.label === 'Day')).toBe(true);
    expect(r.chips.some((c) => c.key === 'sort' && c.label === 'Oldest first')).toBe(true);
  });

  it('uses Custom label with explicit dates when preset is custom', () => {
    const r = computeActiveFilters({
      timeRange: {
        preset: 'custom',
        customFrom: '2026-04-01T00:00:00.000Z',
        customTo: '2026-04-10T23:59:59.999Z',
      },
      filters: {},
      groupBy: 'none',
      sortBy: { field: 'occurredAt', direction: 'desc' },
    });
    expect(r.chips[0]?.label).toBe('Apr 1 \u2013 Apr 10');
  });
});
