import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmModels, LlmProviders } from '@intexuraos/llm-contract';
import type { ProviderPricing, AggregatedCosts } from '../../domain/ports/index.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';

// Mock Firestore
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

// Mock common-http to control authentication
vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader === 'Bearer valid-token') {
        return { userId: 'user-123' };
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

describe('publicRoutes', () => {
  const mockGooglePricing: ProviderPricing = {
    provider: LlmProviders.Google,
    models: {
      [LlmModels.Gemini25Pro]: {
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
        groundingCostPerRequest: 0.035,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockOpenaiPricing: ProviderPricing = {
    provider: LlmProviders.OpenAI,
    models: {
      [LlmModels.GPT52]: {
        inputPricePerMillion: 1.75,
        outputPricePerMillion: 14.0,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockAnthropicPricing: ProviderPricing = {
    provider: LlmProviders.Anthropic,
    models: {
      [LlmModels.ClaudeOpus45]: {
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockPerplexityPricing: ProviderPricing = {
    provider: LlmProviders.Perplexity,
    models: {
      [LlmModels.SonarPro]: {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockZhipuPricing: ProviderPricing = {
    provider: LlmProviders.Zhipu,
    models: {
      'glm-4-flash': {
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.5,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const fakePricingRepository = {
    getByProvider: vi.fn(),
  };

  const fakeUsageStatsRepository = {
    getUserCosts: vi.fn(),
  };

  beforeEach(() => {
    vi.stubEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN', 'test-token');
    setServices({
      pricingRepository: fakePricingRepository,
      usageStatsRepository: fakeUsageStatsRepository,
    } as ServiceContainer);
  });

  afterEach(() => {
    resetServices();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('GET /settings/pricing', () => {
    it('returns pricing for all providers with valid auth', async () => {
      fakePricingRepository.getByProvider.mockImplementation((provider: string) => {
        switch (provider) {
          case 'google':
            return Promise.resolve(mockGooglePricing);
          case 'openai':
            return Promise.resolve(mockOpenaiPricing);
          case 'anthropic':
            return Promise.resolve(mockAnthropicPricing);
          case 'perplexity':
            return Promise.resolve(mockPerplexityPricing);
          case 'zhipu':
            return Promise.resolve(mockZhipuPricing);
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.google.provider).toBe(LlmProviders.Google);
      expect(body.data.openai.provider).toBe(LlmProviders.OpenAI);
      expect(body.data.anthropic.provider).toBe(LlmProviders.Anthropic);
      expect(body.data.perplexity.provider).toBe(LlmProviders.Perplexity);
      expect(body.data.zhipu.provider).toBe(LlmProviders.Zhipu);
      expect(body.data.google.models[LlmModels.Gemini25Pro].inputPricePerMillion).toBe(1.25);

      await app.close();
    });

    it('returns 401 without auth header', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });

    it('returns 401 with invalid auth token', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });

    it('returns 500 when any provider pricing is missing', async () => {
      fakePricingRepository.getByProvider.mockImplementation((provider: string) => {
        switch (provider) {
          case 'google':
            return Promise.resolve(mockGooglePricing);
          case 'openai':
            return Promise.resolve(mockOpenaiPricing);
          case 'anthropic':
            return Promise.resolve(null); // Missing
          case 'perplexity':
            return Promise.resolve(mockPerplexityPricing);
          case 'zhipu':
            return Promise.resolve(mockZhipuPricing);
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Missing pricing for providers');
      expect(body.error.message).toContain('anthropic');

      await app.close();
    });

    it('returns 500 when all providers are missing', async () => {
      fakePricingRepository.getByProvider.mockResolvedValue(null);

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('Missing pricing for providers');
      // With the new individual checks, it returns on first missing provider (google)
      expect(body.error.message).toContain('google');

      await app.close();
    });

    it('returns 500 when google pricing is missing', async () => {
      fakePricingRepository.getByProvider.mockImplementation((provider: string) => {
        switch (provider) {
          case 'google':
            return Promise.resolve(null); // Missing
          case 'openai':
            return Promise.resolve(mockOpenaiPricing);
          case 'anthropic':
            return Promise.resolve(mockAnthropicPricing);
          case 'perplexity':
            return Promise.resolve(mockPerplexityPricing);
          case 'zhipu':
            return Promise.resolve(mockZhipuPricing);
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('google');

      await app.close();
    });

    it('returns 500 when openai pricing is missing', async () => {
      fakePricingRepository.getByProvider.mockImplementation((provider: string) => {
        switch (provider) {
          case 'google':
            return Promise.resolve(mockGooglePricing);
          case 'openai':
            return Promise.resolve(null); // Missing
          case 'anthropic':
            return Promise.resolve(mockAnthropicPricing);
          case 'perplexity':
            return Promise.resolve(mockPerplexityPricing);
          case 'zhipu':
            return Promise.resolve(mockZhipuPricing);
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('openai');

      await app.close();
    });

    it('returns 500 when perplexity pricing is missing', async () => {
      fakePricingRepository.getByProvider.mockImplementation((provider: string) => {
        switch (provider) {
          case 'google':
            return Promise.resolve(mockGooglePricing);
          case 'openai':
            return Promise.resolve(mockOpenaiPricing);
          case 'anthropic':
            return Promise.resolve(mockAnthropicPricing);
          case 'perplexity':
            return Promise.resolve(null); // Missing
          case 'zhipu':
            return Promise.resolve(mockZhipuPricing);
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('perplexity');

      await app.close();
    });

    it('returns 500 when zhipu pricing is missing', async () => {
      fakePricingRepository.getByProvider.mockImplementation((provider: string) => {
        switch (provider) {
          case 'google':
            return Promise.resolve(mockGooglePricing);
          case 'openai':
            return Promise.resolve(mockOpenaiPricing);
          case 'anthropic':
            return Promise.resolve(mockAnthropicPricing);
          case 'perplexity':
            return Promise.resolve(mockPerplexityPricing);
          case 'zhipu':
            return Promise.resolve(null); // Missing
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/pricing',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('zhipu');

      await app.close();
    });
  });

  describe('GET /settings/usage-costs', () => {
    const mockAggregatedCosts: AggregatedCosts = {
      totalCostUsd: 12.45,
      totalCalls: 234,
      totalInputTokens: 125000,
      totalOutputTokens: 62500,
      monthlyBreakdown: [
        {
          month: '2026-01',
          costUsd: 5.23,
          calls: 150,
          inputTokens: 75000,
          outputTokens: 37500,
          percentage: 42,
        },
        {
          month: '2025-12',
          costUsd: 4.22,
          calls: 84,
          inputTokens: 50000,
          outputTokens: 25000,
          percentage: 34,
        },
      ],
      byModel: [
        { model: 'gemini-2.0-flash-exp', costUsd: 4.5, calls: 80, percentage: 36 },
        { model: 'claude-3.5-sonnet', costUsd: 3.2, calls: 50, percentage: 26 },
      ],
      byCallType: [
        { callType: 'research', costUsd: 8.0, calls: 100, percentage: 64 },
        { callType: 'generate', costUsd: 4.45, calls: 134, percentage: 36 },
      ],
    };

    it('returns usage costs with valid auth', async () => {
      fakeUsageStatsRepository.getUserCosts.mockResolvedValue(mockAggregatedCosts);

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.totalCostUsd).toBe(12.45);
      expect(body.data.totalCalls).toBe(234);
      expect(body.data.monthlyBreakdown).toHaveLength(2);
      expect(body.data.byModel).toHaveLength(2);
      expect(body.data.byCallType).toHaveLength(2);
      expect(fakeUsageStatsRepository.getUserCosts).toHaveBeenCalledWith('user-123', 90);

      await app.close();
    });

    it('respects custom days parameter', async () => {
      fakeUsageStatsRepository.getUserCosts.mockResolvedValue(mockAggregatedCosts);

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs?days=30',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(fakeUsageStatsRepository.getUserCosts).toHaveBeenCalledWith('user-123', 30);

      await app.close();
    });

    it('returns 400 for invalid days parameter', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs?days=invalid',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('days must be between 1 and 365');

      await app.close();
    });

    it('returns 400 for days exceeding max', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs?days=500',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('days must be between 1 and 365');

      await app.close();
    });

    it('returns 400 for days less than 1', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs?days=0',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error.message).toContain('days must be between 1 and 365');

      await app.close();
    });

    it('returns 401 without auth header', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs',
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });

    it('returns empty data for user with no usage', async () => {
      const emptyData: AggregatedCosts = {
        totalCostUsd: 0,
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        monthlyBreakdown: [],
        byModel: [],
        byCallType: [],
      };
      fakeUsageStatsRepository.getUserCosts.mockResolvedValue(emptyData);

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.totalCostUsd).toBe(0);
      expect(body.data.monthlyBreakdown).toHaveLength(0);

      await app.close();
    });

    it('returns 500 when repository throws error', async () => {
      fakeUsageStatsRepository.getUserCosts.mockRejectedValue(new Error('Firestore error'));

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/settings/usage-costs',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error.message).toBe('Failed to fetch usage costs');

      await app.close();
    });
  });
});
