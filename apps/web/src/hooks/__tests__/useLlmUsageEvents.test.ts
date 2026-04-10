/**
 * Tests for useLlmUsageEvents hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLlmUsageEvents } from '../useLlmUsageEvents.js';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { UsageEvent, ListLlmUsageEventsResponse } from '../../types/llmUsage.js';
import type { UseLlmUsageEventsOptions } from '../useLlmUsageEvents.js';

/* ── mocks ─────────────────────────────────────────────────────────── */

const mockGetAccessToken = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

const mockListLlmUsageEvents = vi.fn();

vi.mock('../../services/llmUsageApi.js', () => ({
  listLlmUsageEvents: (...args: unknown[]): unknown => mockListLlmUsageEvents(...args),
}));

/* ── helpers ───────────────────────────────────────────────────────── */

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    schemaVersion: 1,
    eventId: 'evt-1',
    occurredAt: '2026-04-10T10:00:00Z',
    receivedAt: '2026-04-10T10:00:01Z',
    ingress: 'internal',
    owner: { type: 'user', id: 'user-1' },
    source: { service: 'svc', component: 'comp', client: 'cli', environment: 'dev' },
    request: { provider: LlmProviders.Anthropic, model: 'claude-sonnet-4', operation: 'chat', success: true, durationMs: 1000 },
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      thinkingTokens: 0,
      webSearchCalls: 0,
      groundingEnabled: false,
      imageCount: 0,
    },
    cost: { billedUsd: 0.01, providerReportedUsd: null, calculatedUsd: null, pricingSource: 'manual' },
    correlation: { requestId: null, traceId: null, taskId: null, researchId: null, attempt: null, sessionId: null },
    error: null,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ListLlmUsageEventsResponse> = {}): ListLlmUsageEventsResponse {
  return {
    events: [makeEvent()],
    totalMatched: 1,
    ...overrides,
  };
}

const defaultOptions: UseLlmUsageEventsOptions = {
  timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
  filters: {},
  sortBy: { field: 'occurredAt', direction: 'desc' },
};

/* ── tests ─────────────────────────────────────────────────────────── */

describe('useLlmUsageEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches events on mount', async () => {
    mockListLlmUsageEvents.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockListLlmUsageEvents).toHaveBeenCalledWith('test-token', {
      timeRange: defaultOptions.timeRange,
      filters: defaultOptions.filters,
      sortBy: defaultOptions.sortBy,
      limit: 50,
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.totalMatched).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    mockListLlmUsageEvents.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network failure');
    expect(result.current.events).toEqual([]);
  });

  it('sets hasMore when nextCursor is present', async () => {
    mockListLlmUsageEvents.mockResolvedValue(makeResponse({ nextCursor: 'cursor-abc' }));

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
  });

  it('sets hasMore false when no nextCursor', async () => {
    mockListLlmUsageEvents.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(false);
  });

  it('loads more events and appends them', async () => {
    const event1 = makeEvent({ eventId: 'evt-1' });
    mockListLlmUsageEvents.mockResolvedValue(
      makeResponse({ events: [event1], nextCursor: 'cursor-1' }),
    );

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const event2 = makeEvent({ eventId: 'evt-2' });
    mockListLlmUsageEvents.mockResolvedValue(makeResponse({ events: [event2] }));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0]?.eventId).toBe('evt-1');
    expect(result.current.events[1]?.eventId).toBe('evt-2');
  });

  it('does not loadMore when hasMore is false', async () => {
    mockListLlmUsageEvents.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callCount = mockListLlmUsageEvents.mock.calls.length;

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockListLlmUsageEvents).toHaveBeenCalledTimes(callCount);
  });

  it('handles loadMore error', async () => {
    mockListLlmUsageEvents.mockResolvedValue(makeResponse({ nextCursor: 'cursor-1' }));

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockListLlmUsageEvents.mockRejectedValue(new Error('Load more failed'));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe('Load more failed');
    expect(result.current.loadingMore).toBe(false);
  });

  it('refresh replaces all data', async () => {
    const event1 = makeEvent({ eventId: 'evt-1' });
    mockListLlmUsageEvents.mockResolvedValue(makeResponse({ events: [event1] }));

    const { result } = renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const event2 = makeEvent({ eventId: 'evt-2' });
    mockListLlmUsageEvents.mockResolvedValue(makeResponse({ events: [event2], totalMatched: 5 }));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]?.eventId).toBe('evt-2');
    expect(result.current.totalMatched).toBe(5);
  });

  it('polls every 30s when document is visible', async () => {
    mockListLlmUsageEvents.mockResolvedValue(makeResponse());

    renderHook(() => useLlmUsageEvents(defaultOptions));

    await waitFor(() => {
      expect(mockListLlmUsageEvents).toHaveBeenCalledTimes(1);
    });

    const callsBefore = mockListLlmUsageEvents.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(30001);
    });

    expect(mockListLlmUsageEvents.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('re-fetches when options change', async () => {
    mockListLlmUsageEvents.mockResolvedValue(makeResponse());

    const { result, rerender } = renderHook(
      (props: UseLlmUsageEventsOptions) => useLlmUsageEvents(props),
      { initialProps: defaultOptions },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const newOptions: UseLlmUsageEventsOptions = {
      ...defaultOptions,
      filters: { providers: ['openai'] },
    };

    mockListLlmUsageEvents.mockResolvedValue(makeResponse({ events: [] }));

    rerender(newOptions);

    await waitFor(() => {
      expect(mockListLlmUsageEvents).toHaveBeenCalledWith('test-token', expect.objectContaining({
        filters: { providers: ['openai'] },
      }));
    });
  });
});
