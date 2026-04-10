/**
 * Tests for useLlmUsageEvent hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLlmUsageEvent } from '../useLlmUsageEvent.js';
import { LlmProviders } from '@intexuraos/llm-contract';
import type { UsageEvent, GetUsageEventResponse } from '../../types/llmUsage.js';

/* ── mocks ─────────────────────────────────────────────────────────── */

const mockGetAccessToken = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

const mockGetLlmUsageEvent = vi.fn();

vi.mock('../../services/llmUsageApi.js', () => ({
  getLlmUsageEvent: (...args: unknown[]): unknown => mockGetLlmUsageEvent(...args),
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

/* ── tests ─────────────────────────────────────────────────────────── */

describe('useLlmUsageEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a single event on mount', async () => {
    const event = makeEvent({ eventId: 'evt-42' });
    const response: GetUsageEventResponse = { event };
    mockGetLlmUsageEvent.mockResolvedValue(response);

    const { result } = renderHook(() => useLlmUsageEvent('evt-42'));
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetLlmUsageEvent).toHaveBeenCalledWith('test-token', 'evt-42');
    expect(result.current.event).toEqual(event);
    expect(result.current.error).toBeNull();
  });

  it('handles fetch error', async () => {
    mockGetLlmUsageEvent.mockRejectedValue(new Error('Not found'));

    const { result } = renderHook(() => useLlmUsageEvent('evt-missing'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Not found');
    expect(result.current.event).toBeNull();
  });

  it('re-fetches when eventId changes', async () => {
    const event1 = makeEvent({ eventId: 'evt-1' });
    mockGetLlmUsageEvent.mockResolvedValue({ event: event1 });

    const { result, rerender } = renderHook(
      (props: { eventId: string }) => useLlmUsageEvent(props.eventId),
      { initialProps: { eventId: 'evt-1' } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.event?.eventId).toBe('evt-1');

    const event2 = makeEvent({ eventId: 'evt-2' });
    mockGetLlmUsageEvent.mockResolvedValue({ event: event2 });

    rerender({ eventId: 'evt-2' });

    await waitFor(() => {
      expect(result.current.event?.eventId).toBe('evt-2');
    });

    expect(mockGetLlmUsageEvent).toHaveBeenCalledWith('test-token', 'evt-2');
  });

  it('starts with null event and loading true', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    mockGetLlmUsageEvent.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useLlmUsageEvent('evt-1'));

    expect(result.current.event).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
