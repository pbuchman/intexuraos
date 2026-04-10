import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AggregatedCosts } from '../../domain/ports/index.js';
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
  const fakeUsageStatsRepository = {
    getUserCosts: vi.fn(),
  };

  beforeEach(() => {
    vi.stubEnv('INTEXURAOS_INTERNAL_AUTH_TOKEN', 'test-token');
    setServices({
      usageStatsRepository: fakeUsageStatsRepository,
    } as ServiceContainer);
  });

  afterEach(() => {
    resetServices();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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
