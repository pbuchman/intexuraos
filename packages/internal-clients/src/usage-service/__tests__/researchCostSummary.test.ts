import nock from 'nock';
import { afterEach, describe, expect, it } from 'vitest';
import { createUsageServiceClient } from '../client.js';
import type { UsageServiceConfig } from '../types.js';

const BASE_URL = 'https://usage.example.com';
const config: UsageServiceConfig = {
  baseUrl: BASE_URL,
  internalAuthToken: 'test-token',
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => config.logger,
  } as unknown as UsageServiceConfig['logger'],
};

afterEach(() => {
  nock.cleanAll();
});

describe('createUsageServiceClient research cost summary', () => {
  it('returns the summary payload on success', async () => {
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
    const scope = nock(BASE_URL)
      .post('/internal/usage/research-cost-summary', {
        researchId: 'research-1',
        owner: { type: 'user', id: 'user-1' },
        timeRange: {
          from: '2024-01-01T10:00:00.000Z',
          to: '2024-01-01T12:00:00.000Z',
        },
      })
      .matchHeader('x-internal-auth', 'test-token')
      .reply(200, { success: true, data: summary });

    const client = createUsageServiceClient(config);
    const result = await client.getResearchCostSummary(
      'research-1',
      { type: 'user', id: 'user-1' },
      {
        from: '2024-01-01T10:00:00.000Z',
        to: '2024-01-01T12:00:00.000Z',
      }
    );

    expect(scope.isDone()).toBe(true);
    expect(result).toEqual({ ok: true, value: summary });
  });

  it('forwards X-Trace-Id when provided in the request options', async () => {
    const scope = nock(BASE_URL)
      .post('/internal/usage/research-cost-summary')
      .matchHeader('x-internal-auth', 'test-token')
      .matchHeader('x-trace-id', 'trace-123')
      .reply(200, {
        success: true,
        data: {
          researchId: 'research-1',
          totals: {
            calls: 0,
            costUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
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
        },
      });

    const client = createUsageServiceClient(config);
    const result = await client.getResearchCostSummary(
      'research-1',
      { type: 'user', id: 'user-1' },
      {
        from: '2024-01-01T10:00:00.000Z',
        to: '2024-01-01T12:00:00.000Z',
      },
      { traceId: 'trace-123' }
    );

    expect(scope.isDone()).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('returns API_ERROR with the response text on failure', async () => {
    nock(BASE_URL).post('/internal/usage/research-cost-summary').reply(503, 'service unavailable');

    const client = createUsageServiceClient(config);
    const result = await client.getResearchCostSummary(
      'research-1',
      { type: 'user', id: 'user-1' },
      {
        from: '2024-01-01T10:00:00.000Z',
        to: '2024-01-01T12:00:00.000Z',
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'HTTP 503: service unavailable',
      },
    });
  });

  it('returns NETWORK_ERROR when the request fails before a response arrives', async () => {
    nock(BASE_URL).post('/internal/usage/research-cost-summary').replyWithError('socket hang up');

    const client = createUsageServiceClient(config);
    const result = await client.getResearchCostSummary(
      'research-1',
      { type: 'user', id: 'user-1' },
      {
        from: '2024-01-01T10:00:00.000Z',
        to: '2024-01-01T12:00:00.000Z',
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'NETWORK_ERROR',
        message: 'socket hang up',
      },
    });
  });

  it('fails closed when the response body reports success=false', async () => {
    nock(BASE_URL)
      .post('/internal/usage/research-cost-summary')
      .reply(200, {
        success: false,
        error: {
          code: 'DOWNSTREAM_ERROR',
          message: 'Aggregation pipeline failed',
        },
      });

    const client = createUsageServiceClient(config);
    const result = await client.getResearchCostSummary(
      'research-1',
      { type: 'user', id: 'user-1' },
      {
        from: '2024-01-01T10:00:00.000Z',
        to: '2024-01-01T12:00:00.000Z',
      }
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'API_ERROR',
        message: 'DOWNSTREAM_ERROR: Aggregation pipeline failed',
      },
    });
  });
});
