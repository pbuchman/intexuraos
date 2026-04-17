/**
 * Tests for llmUsageApi service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmProviders } from '@intexuraos/llm-contract';
import {
  listLlmUsageEvents,
  getLlmUsageEvent,
  queryLlmUsage,
  getLlmPricing,
} from '../llmUsageApi.js';
import type {
  ListLlmUsageEventsResponse,
  GetUsageEventResponse,
  LlmUsageQueryResponse,
  UsageEvent,
  AggregateMetrics,
  AllProvidersPricing,
  ProviderPricing,
} from '../../types/index.js';

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    llmUsageServiceUrl: 'https://llm-usage.test',
  },
}));

function makeUsageEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    schemaVersion: 1,
    eventId: 'evt-001',
    occurredAt: '2026-04-10T12:00:00Z',
    receivedAt: '2026-04-10T12:00:01Z',
    ingress: 'internal',
    owner: { type: 'user', id: 'user-123' },
    source: { service: 'research-agent', component: 'llm', client: 'web', environment: 'dev' },
    request: { provider: LlmProviders.OpenAI, model: 'gpt-4o', operation: 'research', success: true, durationMs: 1500 },
    usage: {
      inputTokens: 100, outputTokens: 200, totalTokens: 300,
      cacheReadTokens: 0, cacheWriteTokens: 0, cachedTokens: 0,
      reasoningTokens: 0, thinkingTokens: 0, webSearchCalls: 0,
      groundingEnabled: false, imageCount: 0,
    },
    cost: { billedUsd: 0.005, providerReportedUsd: null, calculatedUsd: 0.005, pricingSource: 'calculated' },
    correlation: { requestId: null, traceId: null, taskId: null, researchId: null, attempt: null, sessionId: null },
    error: null,
    ...overrides,
  };
}

function makeMetrics(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    calls: 10, costUsd: 0.05, inputTokens: 1000, outputTokens: 2000, totalTokens: 3000,
    cacheReadTokens: 0, cacheWriteTokens: 0, cachedTokens: 0,
    reasoningTokens: 0, thinkingTokens: 0, webSearchCalls: 0, imageCount: 0,
    ...overrides,
  };
}

function makeProviderPricing(provider: ProviderPricing['provider']): ProviderPricing {
  return {
    provider,
    models: {
      'test-model': {
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 2.0,
      },
    },
    updatedAt: '2026-04-10T12:00:00Z',
  };
}

function makeAllProvidersPricing(): AllProvidersPricing {
  return {
    google: makeProviderPricing(LlmProviders.Google),
    openai: makeProviderPricing(LlmProviders.OpenAI),
    anthropic: makeProviderPricing(LlmProviders.Anthropic),
    perplexity: makeProviderPricing(LlmProviders.Perplexity),
  };
}

describe('llmUsageApi', () => {
  const mockAccessToken = 'test-access-token';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listLlmUsageEvents', () => {
    it('sends POST with correct URL, method, and body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: ListLlmUsageEventsResponse = {
        events: [makeUsageEvent()],
        totalMatched: 1,
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const request = {
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
      };
      const result = await listLlmUsageEvents(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://llm-usage.test',
        '/llm-usage/events/list',
        mockAccessToken,
        { method: 'POST', body: request }
      );
      expect(result).toEqual(mockResponse);
    });

    it('passes filters, sorting, limit, and cursor when provided', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ events: [], totalMatched: 0 });

      const request = {
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
        filters: { providers: ['openai'], success: true },
        sortBy: { field: 'costUsd' as const, direction: 'desc' as const },
        limit: 25,
        cursor: 'abc123',
      };
      await listLlmUsageEvents(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://llm-usage.test',
        '/llm-usage/events/list',
        mockAccessToken,
        { method: 'POST', body: request }
      );
    });

    it('propagates errors from apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('Network error'));

      await expect(
        listLlmUsageEvents(mockAccessToken, {
          timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
        })
      ).rejects.toThrow('Network error');
    });
  });

  describe('getLlmUsageEvent', () => {
    it('fetches a single event by ID', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: GetUsageEventResponse = { event: makeUsageEvent({ eventId: 'evt-42' }) };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await getLlmUsageEvent(mockAccessToken, 'evt-42');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://llm-usage.test',
        '/llm-usage/events/evt-42',
        mockAccessToken
      );
      expect(result).toEqual(mockResponse);
    });

    it('encodes special characters in eventId', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ event: makeUsageEvent() });

      await getLlmUsageEvent(mockAccessToken, 'evt/special&chars');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://llm-usage.test',
        '/llm-usage/events/evt%2Fspecial%26chars',
        mockAccessToken
      );
    });

    it('propagates errors from apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('Not found'));

      await expect(
        getLlmUsageEvent(mockAccessToken, 'evt-missing')
      ).rejects.toThrow('Not found');
    });
  });

  describe('queryLlmUsage', () => {
    it('sends POST with correct URL, method, and body', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: LlmUsageQueryResponse = {
        rows: [{ group: { 'request.provider': LlmProviders.OpenAI }, metrics: makeMetrics() }],
        totals: makeMetrics(),
      };
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const request = {
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
        groupBy: ['request.provider'],
      };
      const result = await queryLlmUsage(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://llm-usage.test',
        '/llm-usage/query',
        mockAccessToken,
        { method: 'POST', body: request }
      );
      expect(result).toEqual(mockResponse);
    });

    it('passes all query options when provided', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({ rows: [], totals: makeMetrics() });

      const request = {
        timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
        filters: { services: ['research-agent'], models: ['gpt-4o'] },
        groupBy: ['request.provider', 'request.model'],
        sortBy: { field: 'costUsd', direction: 'desc' as const },
        limit: 50,
      };
      await queryLlmUsage(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://llm-usage.test',
        '/llm-usage/query',
        mockAccessToken,
        { method: 'POST', body: request }
      );
    });

    it('propagates errors from apiRequest', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('Bad request'));

      await expect(
        queryLlmUsage(mockAccessToken, {
          timeRange: { from: '2026-04-01T00:00:00Z', to: '2026-04-10T23:59:59Z' },
        })
      ).rejects.toThrow('Bad request');
    });
  });

  describe('getLlmPricing', () => {
    it('GETs /llm-usage/pricing on llmUsageServiceUrl with bearer token', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse = makeAllProvidersPricing();
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await getLlmPricing(mockAccessToken);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://llm-usage.test',
        '/llm-usage/pricing',
        mockAccessToken
      );
      expect(result).toEqual(mockResponse);
    });

    it('calls llmUsageServiceUrl, not the old appSettingsServiceUrl', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(makeAllProvidersPricing());

      await getLlmPricing(mockAccessToken);

      const calledUrl = vi.mocked(apiRequest).mock.calls[0]?.[0] ?? '';
      expect(calledUrl).toBe('https://llm-usage.test');
      expect(calledUrl).not.toContain('settings');
    });

    it('propagates errors from apiRequest (e.g. 401 Unauthorized)', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockRejectedValue(new Error('Unauthorized'));

      await expect(getLlmPricing(mockAccessToken)).rejects.toThrow('Unauthorized');
    });
  });
});
