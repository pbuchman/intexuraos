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
} from './fakes.js';
import type { DataInsight } from '../domain/dataInsights/types.js';

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

describe('dataInsightsRoutes', () => {
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeDataAnalysisService: FakeDataAnalysisService;
  let fakeChartDefinitionService: FakeChartDefinitionService;
  let fakeDataTransformService: FakeDataTransformService;
  let fakeDataSourceRepo: FakeDataSourceRepository;
  let fakeTitleService: FakeTitleGenerationService;
  let fakeFeedNameService: FakeFeedNameGenerationService;
  let fakeMobileNotificationsClient: FakeMobileNotificationsClient;

  beforeEach(() => {
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeDataAnalysisService = new FakeDataAnalysisService();
    fakeChartDefinitionService = new FakeChartDefinitionService();
    fakeDataTransformService = new FakeDataTransformService();
    fakeDataSourceRepo = new FakeDataSourceRepository();
    fakeTitleService = new FakeTitleGenerationService();
    fakeFeedNameService = new FakeFeedNameGenerationService();
    fakeMobileNotificationsClient = new FakeMobileNotificationsClient();
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
    });
  });

  afterEach(() => {
    resetServices();
    fakeCompositeFeedRepo.clear();
    fakeSnapshotRepo.clear();
    fakeDataSourceRepo.clear();
  });

  describe('POST /composite-feeds/:feedId/analyze', () => {
    it('analyzes composite feed data successfully', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      const parsedInsights = [
        {
          title: 'Upward Trend',
          description: 'Values show consistent upward trend.',
          trackableMetric: 'Growth rate',
          suggestedChartType: 'C1',
        },
        {
          title: 'Maximum Value',
          description: 'The highest value reached was 30.',
          trackableMetric: 'Maximum daily value',
          suggestedChartType: 'C1',
        },
      ];

      fakeDataAnalysisService.setResult({ insights: parsedInsights });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/analyze`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.insights).toHaveLength(2);
      expect(body.data.insights[0].title).toBe('Upward Trend');
      expect(body.data.insights[0].id).toBe(`${feed?.id ?? ''}-insight-1`);
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/some-feed/analyze',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when feed does not exist', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/non-existent/analyze',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Composite feed not found');
    });

    it('returns 404 when snapshot does not exist', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/analyze`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('No snapshot available. Please refresh the feed first.');
    });

    it('returns 500 when composite feed repository fails', async () => {
      const app = await buildServer();

      fakeCompositeFeedRepo.setFailNextGet(true);

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/analyze`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when snapshot repository fails', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      fakeSnapshotRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/analyze`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when data analysis service fails', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      fakeDataAnalysisService.setError({
        code: 'GENERATION_ERROR',
        message: 'Rate limit exceeded',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/analyze`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when NO_INSIGHTS error occurs', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      fakeDataAnalysisService.setResult({
        insights: [],
        noInsightsReason: 'Data is too static and lacks variance',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/analyze`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Data is too static and lacks variance');
    });

    it('returns noInsightsReason when insights exist with reason', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      const parsedInsights = [
        {
          title: 'Limited Trend',
          description: 'Some trend.',
          trackableMetric: 'Growth',
          suggestedChartType: 'C1',
        },
      ];

      fakeDataAnalysisService.setResult({
        insights: parsedInsights,
        noInsightsReason: 'Limited data variance',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/analyze`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.noInsightsReason).toBe('Limited data variance');
    });
  });

  describe('POST /composite-feeds/:feedId/insights/:insightId/chart-definition', () => {
    const setupFeedWithInsights = async (): Promise<string> => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      const insights: DataInsight[] = [
        {
          id: 'cf-1-insight-1',
          title: 'Upward Trend',
          description: 'Values show consistent upward trend.',
          trackableMetric: 'Growth rate',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
      ];

      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);
      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      return feed?.id ?? '';
    };

    it('generates chart definition successfully', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      fakeChartDefinitionService.setResult({
        vegaLiteConfig: { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', mark: 'line' },
        transformInstructions: 'Filter to last 7 days and sort by date ascending',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/insights/cf-1-insight-1/chart-definition`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.vegaLiteConfig).toBeDefined();
      expect(body.data.dataTransformInstructions).toBe('Filter to last 7 days and sort by date ascending');
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/some-feed/insights/some-insight/chart-definition',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when feed does not exist', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/non-existent/insights/insight-1/chart-definition',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when snapshot does not exist', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      const insights: DataInsight[] = [
        {
          id: 'cf-1-insight-1',
          title: 'Test',
          description: 'Test.',
          trackableMetric: 'Test',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
      ];
      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/insights/cf-1-insight-1/chart-definition`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when insight does not exist', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/insights/non-existent-insight/chart-definition`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Insight not found: non-existent-insight');
    });

    it('returns 404 when feed has no insights', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/insights/insight-1/chart-definition`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('No insights available. Please analyze the feed first.');
    });

    it('returns 400 when chart type is invalid', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      // Use type assertion to test invalid chart type handling
      const insights: DataInsight[] = [
        {
          id: 'cf-1-insight-1',
          title: 'Test',
          description: 'Test.',
          trackableMetric: 'Test',
          suggestedChartType: 'INVALID_TYPE' as DataInsight['suggestedChartType'],
          generatedAt: new Date().toISOString(),
        },
      ];
      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/insights/cf-1-insight-1/chart-definition`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Invalid chart type: INVALID_TYPE');
    });

    it('returns 500 when chart definition service fails', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      fakeChartDefinitionService.setError({
        code: 'GENERATION_ERROR',
        message: 'Rate limit exceeded',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/insights/cf-1-insight-1/chart-definition`,
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /composite-feeds/:feedId/preview', () => {
    const setupFeedWithInsights = async (): Promise<string> => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      const insights: DataInsight[] = [
        {
          id: 'cf-1-insight-1',
          title: 'Upward Trend',
          description: 'Values show consistent upward trend.',
          trackableMetric: 'Growth rate',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
      ];

      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);
      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      return feed?.id ?? '';
    };

    it('transforms data successfully for preview', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      const transformedData = [
        { date: '2025-01-01', value: 10 },
        { date: '2025-01-02', value: 20 },
        { date: '2025-01-03', value: 30 },
      ];

      fakeDataTransformService.setResult(transformedData);

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/preview`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: {
            $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
            mark: 'line',
          },
          transformInstructions: 'Filter to last 7 days',
          insightId: 'cf-1-insight-1',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.chartData).toEqual(transformedData);
    });

    it('requires authentication', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/some-feed/preview',
        payload: {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'insight-1',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when feed does not exist', async () => {
      const app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/composite-feeds/non-existent/preview',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'insight-1',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when snapshot does not exist', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      const insights: DataInsight[] = [
        {
          id: 'cf-1-insight-1',
          title: 'Test',
          description: 'Test.',
          trackableMetric: 'Test',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
      ];
      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/preview`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'cf-1-insight-1',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when insight does not exist', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/preview`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'non-existent-insight',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Insight not found: non-existent-insight');
    });

    it('returns 404 when feed has no insights', async () => {
      const app = await buildServer();

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feed = feedResult.ok ? feedResult.value : null;

      await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feed?.id ?? 'missing'}/preview`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'insight-1',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('No insights available. Please analyze the feed first.');
    });

    it('returns 500 when data transform service fails', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      fakeDataTransformService.setError({
        code: 'GENERATION_ERROR',
        message: 'Rate limit exceeded',
      });

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/preview`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'cf-1-insight-1',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('handles complex data structures', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      const complexData = [
        {
          date: '2025-01-01',
          value: 10,
          metadata: { source: 'api', verified: true },
        },
        {
          date: '2025-01-02',
          value: 20,
          metadata: { source: 'api', verified: false },
        },
      ];

      fakeDataTransformService.setResult(complexData);

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/preview`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: { mark: 'line' },
          transformInstructions: 'No transform',
          insightId: 'cf-1-insight-1',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.chartData).toEqual(complexData);
    });

    it('handles empty data array', async () => {
      const app = await buildServer();
      const feedId = await setupFeedWithInsights();

      fakeDataTransformService.setResult([]);

      const response = await app.inject({
        method: 'POST',
        url: `/composite-feeds/${feedId}/preview`,
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          chartConfig: { mark: 'line' },
          transformInstructions: 'No transform',
          insightId: 'cf-1-insight-1',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(true);
      expect(body.data.chartData).toEqual([]);
    });
  });
});
