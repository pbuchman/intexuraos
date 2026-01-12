import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeData } from '../../../../domain/dataInsights/usecases/analyzeData.js';
import {
  FakeCompositeFeedRepository,
  FakeSnapshotRepository,
  FakeDataAnalysisService,
} from '../../../fakes.js';

describe('analyzeData', () => {
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeDataAnalysisService: FakeDataAnalysisService;

  beforeEach(() => {
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeDataAnalysisService = new FakeDataAnalysisService();
  });

  describe('success paths', () => {
    it('generates data insights successfully', async () => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);

      const feed = feedResult.ok ? feedResult.value : null;
      const snapshotResult = await fakeSnapshotRepo.upsert(feed?.id ?? '', 'user-123', 'Test Feed', {
        feedId: feed?.id ?? '',
        feedName: 'Test Feed',
        purpose: 'Test purpose',
        generatedAt: new Date().toISOString(),
        staticSources: [],
        notifications: [],
      });

      expect(snapshotResult.ok).toBe(true);

      const parsedInsights = [
        {
          title: 'Upward Trend',
          description: 'Values show consistent upward trend over the period.',
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

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.insights).toHaveLength(2);
        expect(result.value.insights[0]?.id).toBe(`${feed?.id ?? ''}-insight-1`);
        expect(result.value.insights[0]?.title).toBe('Upward Trend');
        expect(result.value.insights[0]?.description).toBe('Values show consistent upward trend over the period.');
        expect(result.value.insights[0]?.trackableMetric).toBe('Growth rate');
        expect(result.value.insights[0]?.suggestedChartType).toBe('C1');
        expect(result.value.insights[0]?.generatedAt).toBeDefined();

        const updatedFeed = await fakeCompositeFeedRepo.getById(feed?.id ?? '', 'user-123');
        expect(updatedFeed.ok).toBe(true);
        if (updatedFeed.ok && updatedFeed.value !== null) {
          expect(updatedFeed.value.dataInsights).toHaveLength(2);
        }
      }
    });

    it('returns result with noInsightsReason when insights exist', async () => {
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
      ];

      fakeDataAnalysisService.setResult({
        insights: parsedInsights,
        noInsightsReason: 'Limited data variance',
      });

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.insights).toHaveLength(1);
        expect(result.value.noInsightsReason).toBe('Limited data variance');
      }
    });

    it('handles empty insights list with noInsightsReason', async () => {
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
        noInsightsReason: 'Data is too static and lacks variance for meaningful analysis',
      });

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NO_INSIGHTS');
        expect(result.error.message).toBe('Data is too static and lacks variance for meaningful analysis');
      }
    });
  });

  describe('error paths', () => {
    it('returns FEED_NOT_FOUND when feed does not exist', async () => {
      const result = await analyzeData('non-existent-feed', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FEED_NOT_FOUND');
        expect(result.error.message).toBe('Composite feed not found');
      }
    });

    it('returns REPOSITORY_ERROR when composite feed repository fails on getById', async () => {
      fakeCompositeFeedRepo.setFailNextGet(true);

      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);

      const feed = feedResult.ok ? feedResult.value : null;

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }
    });

    it('returns SNAPSHOT_NOT_FOUND when snapshot does not exist', async () => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);

      const feed = feedResult.ok ? feedResult.value : null;

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SNAPSHOT_NOT_FOUND');
        expect(result.error.message).toBe('No snapshot available. Please refresh the feed first.');
      }
    });

    it('returns REPOSITORY_ERROR when snapshot repository fails on getByFeedId', async () => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);

      const feed = feedResult.ok ? feedResult.value : null;
      fakeSnapshotRepo.setFailNextGet(true);

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }
    });

    it('returns ANALYSIS_ERROR when data analysis service fails', async () => {
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

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ANALYSIS_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('returns REPOSITORY_ERROR when updateDataInsights fails', async () => {
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
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
          suggestedChartType: 'C1',
        },
      ];

      fakeDataAnalysisService.setResult({ insights: parsedInsights });
      fakeCompositeFeedRepo.setFailNextUpdate(true);

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated update failure');
      }
    });

    it('handles NO_API_KEY error from data analysis service', async () => {
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
        code: 'NO_API_KEY',
        message: 'Please configure your Gemini API key in settings first',
      });

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ANALYSIS_ERROR');
        expect(result.error.message).toBe('Please configure your Gemini API key in settings first');
      }
    });
  });

  describe('edge cases', () => {
    it('generates unique insight IDs based on feed ID and index', async () => {
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
        { title: 'Insight 1', description: 'First.', trackableMetric: 'M1', suggestedChartType: 'C1' },
        { title: 'Insight 2', description: 'Second.', trackableMetric: 'M2', suggestedChartType: 'C2' },
        { title: 'Insight 3', description: 'Third.', trackableMetric: 'M3', suggestedChartType: 'C1' },
      ];

      fakeDataAnalysisService.setResult({ insights: parsedInsights });

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const feedId = feed?.id ?? '';
        expect(result.value.insights[0]?.id).toBe(`${feedId}-insight-1`);
        expect(result.value.insights[1]?.id).toBe(`${feedId}-insight-2`);
        expect(result.value.insights[2]?.id).toBe(`${feedId}-insight-3`);
      }
    });

    it('handles PARSE_ERROR from data analysis service', async () => {
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
        code: 'PARSE_ERROR',
        message: 'Failed to parse LLM response: Invalid format',
      });

      const result = await analyzeData(feed?.id ?? '', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataAnalysisService: fakeDataAnalysisService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ANALYSIS_ERROR');
        expect(result.error.message).toContain('Failed to parse LLM response');
      }
    });
  });
});
