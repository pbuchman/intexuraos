import nock from 'nock';
import { describe, it, expect, afterEach } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import { createUsageServiceClient } from '../client.js';
import type {
  UsageServiceConfig,
  UsageIngestRequest,
  UsageQueryRequest,
  PricingResponse,
} from '../types.js';

const BASE_URL = 'http://localhost:8132';
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

const sampleIngestRequest: UsageIngestRequest = {
  schemaVersion: 1,
  events: [
    {
      schemaVersion: 1,
      eventId: 'evt_001',
      occurredAt: '2026-04-10T00:00:00Z',
      owner: { type: 'user', id: 'u1' },
      source: { service: 'research', component: 'agent', client: 'web', environment: 'dev' },
      request: {
        provider: LlmProviders.Google,
        model: LlmModels.Gemini25Flash,
        operation: 'research',
        success: true,
        durationMs: 1200,
      },
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
      cost: {
        billedUsd: 0.001,
        providerReportedUsd: null,
        calculatedUsd: 0.001,
        pricingSource: 'calculated',
      },
      correlation: {
        requestId: 'req_1',
        traceId: 'trace_1',
        taskId: null,
        researchId: null,
        attempt: null,
        sessionId: null,
      },
      error: null,
    },
  ],
};

const sampleIngestResponse = {
  accepted: 1,
  duplicates: 0,
  rejected: [],
};

const sampleQueryRequest: UsageQueryRequest = {
  timeRange: {
    from: '2026-04-01T00:00:00Z',
    to: '2026-04-10T23:59:59Z',
  },
  filters: {
    ownerIds: ['u1'],
  },
};

const sampleQueryResponse = {
  rows: [
    {
      group: { provider: LlmProviders.Google },
      metrics: {
        calls: 10,
        costUsd: 0.05,
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        thinkingTokens: 0,
        webSearchCalls: 0,
        imageCount: 0,
      },
    },
  ],
  totals: {
    calls: 10,
    costUsd: 0.05,
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    thinkingTokens: 0,
    webSearchCalls: 0,
    imageCount: 0,
  },
};

afterEach(() => {
  nock.cleanAll();
});

describe('createUsageServiceClient', () => {
  describe('ingestEvents', () => {
    it('sends X-Internal-Auth header', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/usage/events')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: sampleIngestResponse });

      const client = createUsageServiceClient(config);
      await client.ingestEvents(sampleIngestRequest);

      expect(scope.isDone()).toBe(true);
    });

    it('sends X-Trace-Id when provided', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/usage/events')
        .matchHeader('X-Trace-Id', 'trace-abc')
        .reply(200, { success: true, data: sampleIngestResponse });

      const client = createUsageServiceClient(config);
      await client.ingestEvents(sampleIngestRequest, { traceId: 'trace-abc' });

      expect(scope.isDone()).toBe(true);
    });

    it('parses success response correctly', async () => {
      nock(BASE_URL)
        .post('/internal/usage/events')
        .reply(200, { success: true, data: sampleIngestResponse });

      const client = createUsageServiceClient(config);
      const result = await client.ingestEvents(sampleIngestRequest);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(sampleIngestResponse);
      }
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(BASE_URL).post('/internal/usage/events').reply(500);

      const client = createUsageServiceClient(config);
      const result = await client.ingestEvents(sampleIngestRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 500');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock(BASE_URL).post('/internal/usage/events').replyWithError('connection refused');

      const client = createUsageServiceClient(config);
      const result = await client.ingestEvents(sampleIngestRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('queryUsage', () => {
    it('sends X-Internal-Auth header', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/usage/query')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: sampleQueryResponse });

      const client = createUsageServiceClient(config);
      await client.queryUsage(sampleQueryRequest);

      expect(scope.isDone()).toBe(true);
    });

    it('sends X-Trace-Id when provided', async () => {
      const scope = nock(BASE_URL)
        .post('/internal/usage/query')
        .matchHeader('X-Trace-Id', 'trace-xyz')
        .reply(200, { success: true, data: sampleQueryResponse });

      const client = createUsageServiceClient(config);
      await client.queryUsage(sampleQueryRequest, { traceId: 'trace-xyz' });

      expect(scope.isDone()).toBe(true);
    });

    it('parses success response correctly', async () => {
      nock(BASE_URL)
        .post('/internal/usage/query')
        .reply(200, { success: true, data: sampleQueryResponse });

      const client = createUsageServiceClient(config);
      const result = await client.queryUsage(sampleQueryRequest);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(sampleQueryResponse);
      }
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(BASE_URL).post('/internal/usage/query').reply(403);

      const client = createUsageServiceClient(config);
      const result = await client.queryUsage(sampleQueryRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 403');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock(BASE_URL).post('/internal/usage/query').replyWithError('connection refused');

      const client = createUsageServiceClient(config);
      const result = await client.queryUsage(sampleQueryRequest);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('fetchPricing', () => {
    const samplePricingResponse: PricingResponse = {
      [LlmProviders.Google]: {
        provider: LlmProviders.Google,
        models: {
          [LlmModels.Gemini25Flash]: {
            inputPricePerMillion: 0.15,
            outputPricePerMillion: 0.6,
          },
        },
        updatedAt: '2026-04-10T00:00:00Z',
      },
      [LlmProviders.OpenAI]: {
        provider: LlmProviders.OpenAI,
        models: {
          [LlmModels.GPT4oMini]: {
            inputPricePerMillion: 0.15,
            outputPricePerMillion: 0.6,
          },
        },
        updatedAt: '2026-04-10T00:00:00Z',
      },
      [LlmProviders.Anthropic]: {
        provider: LlmProviders.Anthropic,
        models: {
          [LlmModels.ClaudeSonnet45]: {
            inputPricePerMillion: 3,
            outputPricePerMillion: 15,
          },
        },
        updatedAt: '2026-04-10T00:00:00Z',
      },
      [LlmProviders.Perplexity]: {
        provider: LlmProviders.Perplexity,
        models: {
          [LlmModels.SonarPro]: {
            inputPricePerMillion: 3,
            outputPricePerMillion: 15,
          },
        },
        updatedAt: '2026-04-10T00:00:00Z',
      },
      [LlmProviders.OpenRouter]: {
        provider: LlmProviders.OpenRouter,
        models: {
          _placeholder: {
            inputPricePerMillion: 0,
            outputPricePerMillion: 0,
            useProviderCost: true,
          },
        },
        updatedAt: '2026-04-10T00:00:00Z',
        useProviderCost: true,
        costSource: 'provider_reported',
      },
    };

    it('sends X-Internal-Auth header', async () => {
      const scope = nock(BASE_URL)
        .get('/internal/pricing')
        .matchHeader('X-Internal-Auth', 'test-token')
        .reply(200, { success: true, data: samplePricingResponse });

      const client = createUsageServiceClient(config);
      await client.fetchPricing();

      expect(scope.isDone()).toBe(true);
    });

    it('sends X-Trace-Id when provided', async () => {
      const scope = nock(BASE_URL)
        .get('/internal/pricing')
        .matchHeader('X-Trace-Id', 'trace-pricing')
        .reply(200, { success: true, data: samplePricingResponse });

      const client = createUsageServiceClient(config);
      await client.fetchPricing({ traceId: 'trace-pricing' });

      expect(scope.isDone()).toBe(true);
    });

    it('parses success response correctly', async () => {
      nock(BASE_URL)
        .get('/internal/pricing')
        .reply(200, { success: true, data: samplePricingResponse });

      const client = createUsageServiceClient(config);
      const result = await client.fetchPricing();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(samplePricingResponse);
      }
    });

    it('returns API_ERROR on non-200 response', async () => {
      nock(BASE_URL).get('/internal/pricing').reply(500);

      const client = createUsageServiceClient(config);
      const result = await client.fetchPricing();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('API_ERROR');
        expect(result.error.message).toBe('HTTP 500');
      }
    });

    it('returns NETWORK_ERROR on fetch failure', async () => {
      nock(BASE_URL).get('/internal/pricing').replyWithError('connection refused');

      const client = createUsageServiceClient(config);
      const result = await client.fetchPricing();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
      }
    });
  });
});
