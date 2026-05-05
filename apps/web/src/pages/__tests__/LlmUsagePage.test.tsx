/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { LlmUsagePage } from '../LlmUsagePage.js';
import type {
  AggregateMetrics,
  UsageEvent,
  UsageQueryRow,
} from '@/types/llmUsage';
import type { UseLlmUsageEventsResult } from '@/hooks/useLlmUsageEvents';
import type { UseLlmUsageQueryResult } from '@/hooks/useLlmUsageQuery';

const mockUseLlmUsageEvents = vi.fn();
const mockUseLlmUsageQuery = vi.fn();

vi.mock('@/components', () => ({
  Layout: ({ children }: { children: React.ReactNode }): React.JSX.Element => <div>{children}</div>,
}));

vi.mock('@/hooks/useLlmUsageEvents', () => ({
  useLlmUsageEvents: (args: unknown): unknown => mockUseLlmUsageEvents(args),
}));

vi.mock('@/hooks/useLlmUsageQuery', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useLlmUsageQuery')>('@/hooks/useLlmUsageQuery');
  return {
    ...actual,
    useLlmUsageQuery: (args: unknown): unknown => mockUseLlmUsageQuery(args),
  };
});

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    schemaVersion: 1,
    eventId: 'evt-image-1',
    occurredAt: '2026-05-05T10:00:00Z',
    receivedAt: '2026-05-05T10:00:01Z',
    ingress: 'internal',
    owner: { type: 'user', id: 'user-1' },
    source: { service: 'research-agent', component: 'image-generation', client: 'web', environment: 'prod' },
    request: {
      provider: LlmProviders.OpenAI,
      model: LlmModels.GPTImage1,
      operation: 'image-generation',
      promptType: 'image-generation',
      success: true,
      durationMs: 1200,
    },
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      thinkingTokens: 0,
      webSearchCalls: 0,
      groundingEnabled: false,
      imageCount: 1,
    },
    cost: { billedUsd: 0.0425, providerReportedUsd: null, calculatedUsd: null, pricingSource: 'manual' },
    correlation: { requestId: null, traceId: null, taskId: null, researchId: null, attempt: null, sessionId: null },
    error: null,
    ...overrides,
  };
}

function makeTotals(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    calls: 1,
    costUsd: 0.25,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
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

function makeEventsResult(overrides: Partial<UseLlmUsageEventsResult> = {}): UseLlmUsageEventsResult {
  return {
    events: [makeEvent()],
    loading: false,
    loadingMore: false,
    error: null,
    hasMore: false,
    totalMatched: 1,
    loadMore: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

function makeQueryResult(overrides: Partial<UseLlmUsageQueryResult> = {}): UseLlmUsageQueryResult {
  const row: UsageQueryRow = {
    group: { 'request.promptType': 'image-generation' },
    metrics: makeTotals(),
  };

  return {
    rows: [row],
    totals: makeTotals(),
    loading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <LlmUsagePage />
    </MemoryRouter>,
  );
}

describe('LlmUsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUseLlmUsageEvents.mockReturnValue(makeEventsResult());
    mockUseLlmUsageQuery.mockReturnValue(makeQueryResult());
  });

  it('renders nonzero billed image-generation cost from raw usage events', () => {
    renderPage();

    expect(screen.getAllByText('image-generation').length).toBeGreaterThan(0);
    expect(screen.getByText('$0.04')).toBeInTheDocument();
  });

  it('requests prompt-type aggregates and renders backend prompt-type labels', async () => {
    renderPage();

    const promptTypeButtons = screen.getAllByRole('button', { name: 'Prompt Type' });
    fireEvent.click(promptTypeButtons[0]);

    await waitFor(() => {
      expect(mockUseLlmUsageQuery).toHaveBeenLastCalledWith(
        expect.objectContaining({
          groupBy: ['request.promptType'],
          enabled: true,
        }),
      );
    });

    expect(screen.getAllByRole('columnheader', { name: 'Prompt Type' }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('image-generation').length).toBeGreaterThan(0);
  });
});
