import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@intexuraos/common-core';
import { createResearchCostSummaryClient } from '../../../infra/usage/researchCostSummaryClient.js';

const logger: Logger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

const timeRange = {
  from: '2024-01-01T10:00:00.000Z',
  to: '2024-01-01T12:00:00.000Z',
};

describe('createResearchCostSummaryClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the research cost summary from a successful usage-service response', async () => {
    const summary = {
      researchId: 'research-1',
      totals: {
        calls: 2,
        costUsd: 0.42,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        webSearchCalls: 0,
        imageCount: 0,
      },
      diagnostics: {
        missingAttribution: {
          count: 0,
          costUsd: 0,
          eventIds: [],
        },
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, data: summary }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createResearchCostSummaryClient({
      baseUrl: 'https://usage.example.com',
      internalAuthToken: 'internal-token',
      logger,
    });

    const result = await client.getResearchCostSummary(
      'research-1',
      { type: 'user', id: 'user-1' },
      timeRange
    );

    expect(result).toEqual({ ok: true, value: summary });
  });

  it('returns an API error when usage-service rejects the summary request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('service unavailable'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createResearchCostSummaryClient({
      baseUrl: 'https://usage.example.com',
      internalAuthToken: 'internal-token',
      logger,
    });

    const result = await client.getResearchCostSummary(
      'research-1',
      { type: 'user', id: 'user-1' },
      timeRange
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 503: service unavailable',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://usage.example.com/internal/usage/research-cost-summary',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Auth': 'internal-token',
        },
        body: JSON.stringify({
          researchId: 'research-1',
          owner: { type: 'user', id: 'user-1' },
          timeRange,
        }),
      })
    );
  });
});
