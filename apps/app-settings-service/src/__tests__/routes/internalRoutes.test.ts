import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderPricing } from '../../domain/ports/index.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';

// Mock Firestore
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

describe('internalRoutes', () => {
  const mockGooglePricing: ProviderPricing = {
    provider: 'google',
    models: {
      'gemini-2.5-pro': {
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
        groundingCostPerRequest: 0.035,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockOpenaiPricing: ProviderPricing = {
    provider: 'openai',
    models: {
      'gpt-5.2': {
        inputPricePerMillion: 1.75,
        outputPricePerMillion: 14.0,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockAnthropicPricing: ProviderPricing = {
    provider: 'anthropic',
    models: {
      'claude-opus-4-5-20251101': {
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const mockPerplexityPricing: ProviderPricing = {
    provider: 'perplexity',
    models: {
      'sonar-pro': {
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
    },
    updatedAt: '2026-01-05T12:00:00Z',
  };

  const fakePricingRepository = {
    getByProvider: vi.fn(),
  };

  beforeEach(() => {
    vi.stubEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN', 'test-token');
    setServices({
      pricingRepository: fakePricingRepository,
    } as ServiceContainer);
  });

  afterEach(() => {
    resetServices();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  describe('GET /internal/settings/pricing', () => {
    it('returns pricing for all providers', async () => {
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
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing',
        headers: {
          'x-internal-auth': 'test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.google.provider).toBe('google');
      expect(body.data.openai.provider).toBe('openai');
      expect(body.data.anthropic.provider).toBe('anthropic');
      expect(body.data.perplexity.provider).toBe('perplexity');
      expect(body.data.google.models['gemini-2.5-pro'].inputPricePerMillion).toBe(1.25);

      await app.close();
    });

    it('returns 401 without auth header', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing',
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });

    it('returns 401 with invalid auth token', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing',
        headers: {
          'x-internal-auth': 'wrong-token',
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
          default:
            return Promise.resolve(null);
        }
      });

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing',
        headers: {
          'x-internal-auth': 'test-token',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Missing pricing for providers');
      expect(body.error).toContain('anthropic');

      await app.close();
    });
  });
});
