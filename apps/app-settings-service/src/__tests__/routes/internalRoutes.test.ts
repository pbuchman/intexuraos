import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProviderPricing } from '../../domain/ports/index.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';

// Mock Firestore
vi.mock('@intexuraos/infra-firestore', () => ({
  getFirestore: vi.fn(),
}));

describe('internalRoutes', () => {
  const mockPricing: ProviderPricing = {
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

  describe('GET /internal/settings/pricing/:provider', () => {
    it('returns pricing for valid provider', async () => {
      fakePricingRepository.getByProvider.mockResolvedValue(mockPricing);

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing/google',
        headers: {
          'x-internal-auth': 'test-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.provider).toBe('google');
      expect(body.models['gemini-2.5-pro'].inputPricePerMillion).toBe(1.25);

      await app.close();
    });

    it('returns 401 without auth header', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing/google',
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });

    it('returns 401 with invalid auth token', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing/google',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);

      await app.close();
    });

    it('returns 404 for invalid provider', async () => {
      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing/invalid-provider',
        headers: {
          'x-internal-auth': 'test-token',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Unknown provider');

      await app.close();
    });

    it('returns 404 when pricing not found', async () => {
      fakePricingRepository.getByProvider.mockResolvedValue(null);

      const { buildServer } = await import('../../server.js');
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/settings/pricing/anthropic',
        headers: {
          'x-internal-auth': 'test-token',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Pricing not found');

      await app.close();
    });
  });
});
