import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import {
  FakeCompositeFeedRepository,
  FakeSnapshotRepository,
  FakeDataAnalysisService,
  FakeChartDefinitionService,
  FakeDataTransformService,
  FakeDataSourceRepository,
  FakeTitleGenerationService,
  FakeFeedNameGenerationService,
  FakeMobileNotificationsClient,
  FakeVisualizationRepository,
} from './fakes.js';
import type { Visualization } from '../domain/visualization/index.js';
import type { Result } from '@intexuraos/common-core';

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

const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

function makeVisualization(overrides: Partial<Visualization> = {}): Visualization {
  const now = new Date();
  return {
    id: 'viz-1',
    userId: 'user-123',
    feedId: 'cf-1',
    feedName: 'Test Feed',
    insightId: 'cf-1-insight-1',
    insightTitle: 'Spending Breakdown',
    trackableMetric: 'Total spending',
    chartConfig: { mark: 'bar' },
    transformInstructions: 'Group by category',
    chartData: null,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function createFeedWithInsight(
  repo: FakeCompositeFeedRepository
): Promise<{ feedId: string; insightId: string }> {
  const feedResult = await repo.create('user-123', 'Test Feed', {
    purpose: 'Test',
    staticSourceIds: [],
    notificationFilters: [],
  });

  const feed = feedResult.ok ? feedResult.value : null;
  const feedId = feed?.id ?? '';
  const insightId = `${feedId}-insight-1`;

  await repo.updateDataInsights(feedId, 'user-123', [
    {
      id: insightId,
      title: 'Spending Breakdown',
      description: 'Breakdown of spending by category',
      trackableMetric: 'Total spending',
      suggestedChartType: 'C1',
      generatedAt: new Date().toISOString(),
    },
  ]);

  return { feedId, insightId };
}

describe('visualizationRoutes', () => {
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeDataAnalysisService: FakeDataAnalysisService;
  let fakeChartDefinitionService: FakeChartDefinitionService;
  let fakeDataTransformService: FakeDataTransformService;
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeTitleService: FakeTitleGenerationService;
  let fakeFeedNameService: FakeFeedNameGenerationService;
  let fakeMobileNotificationsClient: FakeMobileNotificationsClient;
  let fakeVizRepo: FakeVisualizationRepository;

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeDataAnalysisService = new FakeDataAnalysisService();
    fakeChartDefinitionService = new FakeChartDefinitionService();
    fakeDataTransformService = new FakeDataTransformService();
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeTitleService = new FakeTitleGenerationService();
    fakeFeedNameService = new FakeFeedNameGenerationService();
    fakeMobileNotificationsClient = new FakeMobileNotificationsClient();
    fakeVizRepo = new FakeVisualizationRepository();
    setServices({
      compositeFeedRepository: fakeCompositeFeedRepo,
      snapshotRepository: fakeSnapshotRepo,
      dataAnalysisService: fakeDataAnalysisService,
      chartDefinitionService: fakeChartDefinitionService,
      dataTransformService: fakeDataTransformService,
      dataSourceRepository: fakeDataSourceRepo,
      titleGenerationService: fakeTitleService,
      feedNameGenerationService: fakeFeedNameService,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      visualizationRepository: fakeVizRepo,
    });
  });

  afterEach(() => {
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('POST /visualizations', () => {
    it('creates visualization in pending status', async () => {
      const app = await buildServer();
      const { feedId, insightId } = await createFeedWithInsight(fakeCompositeFeedRepo);

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId,
          insightId,
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('pending');
      expect(body.data.chartData).toBeNull();
      expect(body.data.feedId).toBe(feedId);
      expect(body.data.insightId).toBe(insightId);
      expect(body.data.insightTitle).toBe('Spending Breakdown');
      expect(body.data.trackableMetric).toBe('Total spending');
      expect(body.data.transformInstructions).toBe('Group by category');
      expect(typeof body.data.createdAt).toBe('string');
      expect(typeof body.data.updatedAt).toBe('string');
    });

    it('returns 401 without auth', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        payload: {
          feedId: 'cf-1',
          insightId: 'cf-1-insight-1',
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when feed not found', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId: 'nonexistent-feed',
          insightId: 'some-insight',
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when insight not found on feed', async () => {
      const app = await buildServer();
      const { feedId } = await createFeedWithInsight(fakeCompositeFeedRepo);

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId,
          insightId: 'nonexistent-insight',
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when feed has no insights', async () => {
      const app = await buildServer();
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Empty Feed', {
        purpose: 'Test',
        staticSourceIds: [],
        notificationFilters: [],
      });
      const feedId = feedResult.ok ? feedResult.value.id : '';

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId,
          insightId: 'some-insight',
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 400 when visualization limit exceeded', async () => {
      const app = await buildServer();
      const { feedId, insightId } = await createFeedWithInsight(fakeCompositeFeedRepo);

      for (let i = 0; i < 10; i++) {
        fakeVizRepo.addVisualization(
          makeVisualization({
            id: `viz-existing-${String(i)}`,
            feedId,
            insightId,
          })
        );
      }

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId,
          insightId,
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 500 when repository fails on feed lookup', async () => {
      const app = await buildServer();
      fakeCompositeFeedRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId: 'cf-1',
          insightId: 'insight-1',
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when visualization create fails', async () => {
      const app = await buildServer();
      const { feedId, insightId } = await createFeedWithInsight(fakeCompositeFeedRepo);
      fakeVizRepo.setFailNextCreate(true);

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId,
          insightId,
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when listByFeedId fails during limit check', async () => {
      const app = await buildServer();
      const { feedId, insightId } = await createFeedWithInsight(fakeCompositeFeedRepo);
      fakeVizRepo.setFailNextListByFeed(true);

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          feedId,
          insightId,
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Group by category',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /visualizations', () => {
    it('returns empty array when no visualizations exist', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns all visualizations for the user', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-1' }));
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-2', insightTitle: 'Revenue' }));

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(2);
    });

    it('does not return visualizations from other users', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-1', userId: 'other-user' }));

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });

    it('returns 401 without auth', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations',
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 500 when repository fails', async () => {
      const app = await buildServer();
      fakeVizRepo.setFailNextList(true);

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /visualizations/:id', () => {
    it('returns a visualization by ID', async () => {
      const app = await buildServer();
      const viz = makeVisualization({
        id: 'viz-1',
        chartData: [{ category: 'Food', amount: 100 }],
        status: 'ready',
        lastRefreshedAt: new Date('2026-01-15T10:00:00Z'),
      });
      fakeVizRepo.addVisualization(viz);

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('viz-1');
      expect(body.data.status).toBe('ready');
      expect(body.data.chartData).toEqual([{ category: 'Food', amount: 100 }]);
      expect(body.data.lastRefreshedAt).toBe('2026-01-15T10:00:00.000Z');
      expect(typeof body.data.createdAt).toBe('string');
    });

    it('returns 404 when visualization not found', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations/nonexistent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when visualization belongs to another user', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-1', userId: 'other-user' }));

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 without auth', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations/viz-1',
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 500 when repository fails', async () => {
      const app = await buildServer();
      fakeVizRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('does not include lastError when undefined', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-1' }));

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).not.toHaveProperty('lastError');
      expect(body.data).not.toHaveProperty('lastRefreshedAt');
    });

    it('includes lastError when present', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(
        makeVisualization({ id: 'viz-1', status: 'error', lastError: 'Transform failed' })
      );

      const response = await app.inject({
        method: 'GET',
        url: '/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.lastError).toBe('Transform failed');
      expect(body.data.status).toBe('error');
    });
  });

  describe('DELETE /visualizations/:id', () => {
    it('deletes a visualization', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-1' }));

      const response = await app.inject({
        method: 'DELETE',
        url: '/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({});

      expect(fakeVizRepo.getAll()).toHaveLength(0);
    });

    it('succeeds even when visualization does not exist', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/visualizations/nonexistent',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
    });

    it('returns 401 without auth', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/visualizations/viz-1',
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 500 when repository fails', async () => {
      const app = await buildServer();
      fakeVizRepo.setFailNextDelete(true);

      const response = await app.inject({
        method: 'DELETE',
        url: '/visualizations/viz-1',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /visualizations/:id/refresh', () => {
    it('refreshes a visualization and returns updated state', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(
        makeVisualization({ id: 'viz-1', status: 'ready', chartData: [{ old: true }] })
      );

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations/viz-1/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('viz-1');
      expect(body.data.status).toBe('refreshing');
    });

    it('returns 404 when visualization not found', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations/nonexistent/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when visualization belongs to another user', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-1', userId: 'other-user' }));

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations/viz-1/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns current state immediately when already refreshing', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(makeVisualization({ id: 'viz-1', status: 'refreshing' }));

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations/viz-1/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('refreshing');
    });

    it('returns 401 without auth', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations/viz-1/refresh',
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 500 when repository get fails', async () => {
      const app = await buildServer();
      fakeVizRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations/viz-1/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when second getVisualization call fails during refresh', async () => {
      const app = await buildServer();
      fakeVizRepo.addVisualization(
        makeVisualization({ id: 'viz-1', status: 'ready', chartData: [{ old: true }] })
      );

      let getCallCount = 0;
      const originalGetById = fakeVizRepo.getById.bind(fakeVizRepo);
      fakeVizRepo.getById = async (id: string, userId: string): Promise<Result<Visualization | null, string>> => {
        getCallCount++;
        if (getCallCount >= 2) {
          return { ok: false as const, error: 'Simulated second get failure' };
        }
        return originalGetById(id, userId);
      };

      const response = await app.inject({
        method: 'POST',
        url: '/visualizations/viz-1/refresh',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

});
