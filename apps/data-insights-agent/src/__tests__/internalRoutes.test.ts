import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import {
  FakeDataSourceRepository,
  FakeTitleGenerationService,
  FakeCompositeFeedRepository,
  FakeFeedNameGenerationService,
  FakeMobileNotificationsClient,
  FakeVisualizationRepository,
  FakeSnapshotRepository,
  FakeDataAnalysisService,
  FakeChartDefinitionService,
  FakeDataTransformService,
} from './fakes.js';

const TEST_INTERNAL_TOKEN = 'test-internal-auth-token';

describe('internalRoutes', () => {
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeTitleService: FakeTitleGenerationService;
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeFeedNameService: FakeFeedNameGenerationService;
  let fakeMobileNotificationsClient: FakeMobileNotificationsClient;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeVisualizationRepo: FakeVisualizationRepository;
  let fakeDataAnalysisService: FakeDataAnalysisService;
  let fakeChartDefinitionService: FakeChartDefinitionService;
  let fakeDataTransformService: FakeDataTransformService;

  beforeEach(() => {
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = TEST_INTERNAL_TOKEN;
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeTitleService = new FakeTitleGenerationService();
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeFeedNameService = new FakeFeedNameGenerationService();
    fakeMobileNotificationsClient = new FakeMobileNotificationsClient();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeVisualizationRepo = new FakeVisualizationRepository();
    fakeDataAnalysisService = new FakeDataAnalysisService();
    fakeChartDefinitionService = new FakeChartDefinitionService();
    fakeDataTransformService = new FakeDataTransformService();
    setServices({
      dataSourceRepository: fakeDataSourceRepo,
      titleGenerationService: fakeTitleService,
      compositeFeedRepository: fakeCompositeFeedRepo,
      feedNameGenerationService: fakeFeedNameService,
      mobileNotificationsClient: fakeMobileNotificationsClient,
      snapshotRepository: fakeSnapshotRepo,
      visualizationRepository: fakeVisualizationRepo,
      dataAnalysisService: fakeDataAnalysisService,
      chartDefinitionService: fakeChartDefinitionService,
      dataTransformService: fakeDataTransformService,
    });
  });

  afterEach(() => {
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('POST /internal/visualizations/compute', () => {
    it('computes visualization data successfully', async () => {
      const app = await buildServer();
      fakeVisualizationRepo.addVisualization({
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
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await fakeSnapshotRepo.upsert('cf-1', 'user-123', 'Test Feed', {
        feedId: 'cf-1',
        feedName: 'Test Feed',
        purpose: 'Test',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      fakeDataTransformService.setResult([{ category: 'Food', amount: 100 }]);

      const response = await app.inject({
        method: 'POST',
        url: '/internal/visualizations/compute',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: { visualizationId: 'viz-1' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('ready');
      expect(body.data.chartData).toEqual([{ category: 'Food', amount: 100 }]);
      expect(body.data.lastRefreshedAt).toBeDefined();
    });

    it('returns 401 without internal auth header', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/visualizations/compute',
        payload: { visualizationId: 'viz-1' },
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 with wrong internal auth token', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/visualizations/compute',
        headers: { 'x-internal-auth': 'wrong-token' },
        payload: { visualizationId: 'viz-1' },
      });

      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when visualization not found', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/visualizations/compute',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: { visualizationId: 'nonexistent' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 500 when snapshot not found', async () => {
      const app = await buildServer();
      fakeVisualizationRepo.addVisualization({
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
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/visualizations/compute',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: { visualizationId: 'viz-1' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when data transform fails', async () => {
      const app = await buildServer();
      fakeVisualizationRepo.addVisualization({
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
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await fakeSnapshotRepo.upsert('cf-1', 'user-123', 'Test Feed', {
        feedId: 'cf-1',
        feedName: 'Test Feed',
        purpose: 'Test',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      fakeDataTransformService.setError({ code: 'GENERATION_ERROR', message: 'LLM error' });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/visualizations/compute',
        headers: { 'x-internal-auth': TEST_INTERNAL_TOKEN },
        payload: { visualizationId: 'viz-1' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
