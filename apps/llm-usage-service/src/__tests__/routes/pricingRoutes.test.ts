import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { LlmProviders, LlmModels } from '@intexuraos/llm-contract';
import type { ProviderPricing } from '@intexuraos/llm-contract';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { FakeUsageEventRepository } from '../fakeUsageEventRepository.js';
import { FakeUsageAggregateRepository } from '../fakeUsageAggregateRepository.js';
import { FakePricingRepository } from '../fakePricingRepository.js';
import { FakePricingCache } from '../fakePricingCache.js';

// Mock requireAuth for Auth0 bearer tests — validateInternalAuth is NOT mocked
// so POST /internal/pricing still validates against env var.
vi.mock('@intexuraos/common-http', async () => {
  const actual = await vi.importActual('@intexuraos/common-http');
  return {
    ...actual,
    requireAuth: vi.fn().mockImplementation(async (request, reply) => {
      const authHeader = request.headers.authorization as string | undefined;
      if (authHeader !== undefined && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
          const parts = token.split('.');
          const payloadBase64 = parts[1];
          if (payloadBase64 !== undefined) {
            const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString()) as { sub?: string };
            if (payload.sub !== undefined) {
              return { userId: payload.sub };
            }
          }
        } catch {
          /* Invalid token format */
        }
      }
      await reply.fail('UNAUTHORIZED', 'Missing or invalid Authorization header');
      return null;
    }),
  };
});

function makeTestToken(userId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64');
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString('base64');
  return `${header}.${payload}.sig`;
}

// ---------------------------------------------------------------------------
// Shared mock pricing data
// ---------------------------------------------------------------------------
const mockGooglePricing: ProviderPricing = {
  provider: LlmProviders.Google,
  models: {
    [LlmModels.Gemini25Pro]: {
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 10.0,
      groundingCostPerRequest: 0.035,
    },
  },
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockOpenaiPricing: ProviderPricing = {
  provider: LlmProviders.OpenAI,
  models: {
    [LlmModels.GPT54]: {
      inputPricePerMillion: 1.75,
      outputPricePerMillion: 14.0,
    },
  },
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockAnthropicPricing: ProviderPricing = {
  provider: LlmProviders.Anthropic,
  models: {
    [LlmModels.ClaudeOpus46]: {
      inputPricePerMillion: 5.0,
      outputPricePerMillion: 25.0,
      cacheReadMultiplier: 0.1,
      cacheWriteMultiplier: 1.25,
    },
  },
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockPerplexityPricing: ProviderPricing = {
  provider: LlmProviders.Perplexity,
  models: {
    [LlmModels.SonarPro]: {
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      webSearchCostPerCall: 0.005,
    },
  },
  updatedAt: '2026-04-10T12:00:00Z',
};

const mockOpenRouterPricing: ProviderPricing = {
  provider: LlmProviders.OpenRouter,
  models: {
    'or:meta-llama/llama-3-70b': {
      inputPricePerMillion: 0.59,
      outputPricePerMillion: 0.79,
      useProviderCost: true,
    },
  },
  updatedAt: '2026-04-10T12:00:00Z',
  useProviderCost: true,
  costSource: 'provider_reported',
};

function populateAllProviders(pricingRepo: FakePricingRepository): void {
  pricingRepo.byProvider.set(LlmProviders.Google, mockGooglePricing);
  pricingRepo.byProvider.set(LlmProviders.OpenAI, mockOpenaiPricing);
  pricingRepo.byProvider.set(LlmProviders.Anthropic, mockAnthropicPricing);
  pricingRepo.byProvider.set(LlmProviders.Perplexity, mockPerplexityPricing);
  pricingRepo.byProvider.set(LlmProviders.OpenRouter, mockOpenRouterPricing);
}

describe('pricingRoutes', () => {
  let app: FastifyInstance;
  let pricingRepo: FakePricingRepository;
  const AUTH_TOKEN = 'test-internal-token';

  beforeAll(async () => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = AUTH_TOKEN;
    app = await buildServer();
    await app.ready();
  });

  beforeEach(() => {
    pricingRepo = new FakePricingRepository();
    setServices({
      usageEventRepository: new FakeUsageEventRepository(),
      usageAggregateRepository: new FakeUsageAggregateRepository(),
      pricingRepository: pricingRepo,
      pricingCache: new FakePricingCache(),
      orchestratorSecret: 'test-secret',
    } satisfies ServiceContainer);
  });

  afterEach(() => {
    resetServices();
  });

  afterAll(async () => {
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    await app.close();
  });

  // -------------------------------------------------------------------------
  // POST /internal/pricing
  // -------------------------------------------------------------------------
  describe('POST /internal/pricing', () => {
    it('returns 401 for missing X-Internal-Auth header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/pricing',
        payload: mockGooglePricing,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 and persists pricing for valid request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: mockAnthropicPricing,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { provider: string } };
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe(LlmProviders.Anthropic);

      // Verify persistence via fake repo
      const stored = pricingRepo.byProvider.get(LlmProviders.Anthropic);
      expect(stored).toBeDefined();
      expect(stored?.provider).toBe(LlmProviders.Anthropic);
      expect(stored?.models[LlmModels.ClaudeOpus46]?.inputPricePerMillion).toBe(5.0);
    });

    it('returns 400 for invalid body (missing required fields)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          provider: LlmProviders.Google,
          // missing models and updatedAt
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for invalid provider enum value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          provider: 'invalid-provider',
          models: {},
          updatedAt: '2026-04-10T12:00:00Z',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for model missing required inputPricePerMillion', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: {
          provider: LlmProviders.Google,
          models: {
            [LlmModels.Gemini25Pro]: {
              outputPricePerMillion: 10.0,
              // missing inputPricePerMillion
            },
          },
          updatedAt: '2026-04-10T12:00:00Z',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts pricing with optional fields (useProviderCost, imagePricing)', async () => {
      const pricingWithOptionals: ProviderPricing = {
        provider: LlmProviders.OpenRouter,
        models: {
          'or:meta-llama/llama-3-70b': {
            inputPricePerMillion: 0.59,
            outputPricePerMillion: 0.79,
            useProviderCost: true,
            imagePricing: { '1024x1024': 0.04 },
          },
        },
        updatedAt: '2026-04-10T12:00:00Z',
      };

      const response = await app.inject({
        method: 'POST',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: pricingWithOptionals,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { provider: string } };
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe(LlmProviders.OpenRouter);
    });

    it('returns 500 when repository write fails', async () => {
      pricingRepo.failOnWrite = true;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
        payload: mockGooglePricing,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // GET /internal/pricing
  // -------------------------------------------------------------------------
  describe('GET /internal/pricing', () => {
    it('returns 401 for missing X-Internal-Auth header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/pricing',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 with all provider pricing when fully populated', async () => {
      populateAllProviders(pricingRepo);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: Record<string, ProviderPricing>;
      };
      expect(body.success).toBe(true);
      expect(body.data[LlmProviders.Google]?.provider).toBe(LlmProviders.Google);
      expect(body.data[LlmProviders.OpenAI]?.provider).toBe(LlmProviders.OpenAI);
      expect(body.data[LlmProviders.Anthropic]?.provider).toBe(LlmProviders.Anthropic);
      expect(body.data[LlmProviders.Perplexity]?.provider).toBe(LlmProviders.Perplexity);
      expect(body.data[LlmProviders.OpenRouter]?.provider).toBe(LlmProviders.OpenRouter);

      // Verify provider-level OpenRouter metadata flows through internal endpoint
      const orPricing = body.data[LlmProviders.OpenRouter];
      expect(orPricing?.useProviderCost).toBe(true);
      expect(orPricing?.costSource).toBe('provider_reported');
    });

    it('returns 500 when a provider is missing from the repository', async () => {
      // Only populate 4 out of 5 providers — missing openrouter
      pricingRepo.byProvider.set(LlmProviders.Google, mockGooglePricing);
      pricingRepo.byProvider.set(LlmProviders.OpenAI, mockOpenaiPricing);
      pricingRepo.byProvider.set(LlmProviders.Anthropic, mockAnthropicPricing);
      pricingRepo.byProvider.set(LlmProviders.Perplexity, mockPerplexityPricing);

      const response = await app.inject({
        method: 'GET',
        url: '/internal/pricing',
        headers: { 'x-internal-auth': AUTH_TOKEN },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  // GET /llm-usage/pricing
  // -------------------------------------------------------------------------
  describe('GET /llm-usage/pricing', () => {
    it('returns 401 for missing Authorization bearer header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/llm-usage/pricing',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 200 with all provider pricing when fully populated', async () => {
      populateAllProviders(pricingRepo);

      const response = await app.inject({
        method: 'GET',
        url: '/llm-usage/pricing',
        headers: { authorization: `Bearer ${makeTestToken('user-123')}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: Record<string, ProviderPricing>;
      };
      expect(body.success).toBe(true);
      expect(body.data[LlmProviders.Google]?.provider).toBe(LlmProviders.Google);
      expect(body.data[LlmProviders.OpenAI]?.provider).toBe(LlmProviders.OpenAI);
      expect(body.data[LlmProviders.Anthropic]?.provider).toBe(LlmProviders.Anthropic);
      expect(body.data[LlmProviders.Perplexity]?.provider).toBe(LlmProviders.Perplexity);
      expect(body.data[LlmProviders.OpenRouter]?.provider).toBe(LlmProviders.OpenRouter);

      // Verify OpenRouter model has useProviderCost
      const orPricing = body.data[LlmProviders.OpenRouter];
      expect(orPricing).toBeDefined();
      const orModel = orPricing?.models['or:meta-llama/llama-3-70b'];
      expect(orModel).toBeDefined();
      expect(orModel?.useProviderCost).toBe(true);

      // Verify provider-level OpenRouter metadata (acceptance criterion)
      expect(orPricing?.useProviderCost).toBe(true);
      expect(orPricing?.costSource).toBe('provider_reported');
    });

    it('returns 500 when a provider is missing from the repository', async () => {
      // Only populate 4 out of 5 providers — missing openrouter
      pricingRepo.byProvider.set(LlmProviders.Google, mockGooglePricing);
      pricingRepo.byProvider.set(LlmProviders.OpenAI, mockOpenaiPricing);
      pricingRepo.byProvider.set(LlmProviders.Anthropic, mockAnthropicPricing);
      pricingRepo.byProvider.set(LlmProviders.Perplexity, mockPerplexityPricing);

      const response = await app.inject({
        method: 'GET',
        url: '/llm-usage/pricing',
        headers: { authorization: `Bearer ${makeTestToken('user-123')}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
