/**
 * Tests for useLlmUsageQuery hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLlmUsageQuery } from '../useLlmUsageQuery.js';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { LlmUsageQueryResponse, AggregateMetrics, UsageQueryRow } from '../../types/llmUsage.js';
import type { UseLlmUsageQueryOptions } from '../useLlmUsageQuery.js';

/* ── mocks ─────────────────────────────────────────────────────────── */

const mockGetAccessToken = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

const mockQueryLlmUsage = vi.fn();

vi.mock('../../services/llmUsageApi.js', () => ({
  queryLlmUsage: (...args: unknown[]): unknown => mockQueryLlmUsage(...args),
}));

/* ── helpers ───────────────────────────────────────────────────────── */

function makeTotals(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    calls: 10,
    costUsd: 1.5,
    inputTokens: 5000,
    outputTokens: 2000,
    totalTokens: 7000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    thinkingTokens: 0,
    webSearchCalls: 0,
    imageCount: 0,
    ...overrides,
  };
}

function makeRow(overrides: Partial<UsageQueryRow> = {}): UsageQueryRow {
  return {
    group: { provider: LlmProviders.Anthropic },
    metrics: makeTotals(),
    ...overrides,
  };
}

function makeResponse(overrides: Partial<LlmUsageQueryResponse> = {}): LlmUsageQueryResponse {
  return {
    rows: [makeRow()],
    totals: makeTotals(),
    ...overrides,
  };
}

const defaultOptions: UseLlmUsageQueryOptions = {
  timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
  filters: {},
  groupBy: ['provider'],
};

/* ── tests ─────────────────────────────────────────────────────────── */

describe('useLlmUsageQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches query results on mount', async () => {
    mockQueryLlmUsage.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useLlmUsageQuery(defaultOptions));
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockQueryLlmUsage).toHaveBeenCalledWith('test-token', {
      timeRange: defaultOptions.timeRange,
      filters: defaultOptions.filters,
      groupBy: defaultOptions.groupBy,
    });
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.totals).toEqual(makeTotals());
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    mockQueryLlmUsage.mockRejectedValue(new Error('Query failed'));

    const { result } = renderHook(() => useLlmUsageQuery(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Query failed');
    expect(result.current.rows).toEqual([]);
  });

  it('refresh replaces data', async () => {
    mockQueryLlmUsage.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useLlmUsageQuery(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newTotals = makeTotals({ calls: 20 });
    mockQueryLlmUsage.mockResolvedValue(makeResponse({ rows: [], totals: newTotals }));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.rows).toEqual([]);
    expect(result.current.totals).toEqual(newTotals);
  });

  it('re-fetches when options change', async () => {
    mockQueryLlmUsage.mockResolvedValue(makeResponse());

    const { result, rerender } = renderHook(
      (props: UseLlmUsageQueryOptions) => useLlmUsageQuery(props),
      { initialProps: defaultOptions },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newOptions: UseLlmUsageQueryOptions = {
      ...defaultOptions,
      groupBy: ['model'],
    };

    mockQueryLlmUsage.mockResolvedValue(makeResponse());

    rerender(newOptions);

    await waitFor(() => {
      expect(mockQueryLlmUsage).toHaveBeenCalledWith('test-token', expect.objectContaining({
        groupBy: ['model'],
      }));
    });
  });

  it('starts with null totals before first load', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    mockQueryLlmUsage.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useLlmUsageQuery(defaultOptions));

    expect(result.current.totals).toBeNull();
    expect(result.current.rows).toEqual([]);
  });
});
