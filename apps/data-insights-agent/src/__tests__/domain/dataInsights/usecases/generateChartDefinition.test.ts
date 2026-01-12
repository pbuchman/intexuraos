import { describe, it, expect, beforeEach } from 'vitest';
import { generateChartDefinition } from '../../../../domain/dataInsights/usecases/generateChartDefinition.js';
import {
  FakeCompositeFeedRepository,
  FakeSnapshotRepository,
  FakeChartDefinitionService,
} from '../../../fakes.js';
import type { DataInsight } from '../../../../domain/dataInsights/types.js';

describe('generateChartDefinition', () => {
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeChartDefinitionService: FakeChartDefinitionService;

  beforeEach(() => {
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeChartDefinitionService = new FakeChartDefinitionService();
  });

  describe('success paths', () => {
    it('generates chart definition successfully', async () => {
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

      fakeChartDefinitionService.setResult({
        vegaLiteConfig: { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', mark: 'line' },
        transformInstructions: 'Filter to last 7 days and sort by date ascending',
      });

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.vegaLiteConfig).toBeDefined();
        expect(result.value.dataTransformInstructions).toBe('Filter to last 7 days and sort by date ascending');
      }
    });

    it('returns chart definition with valid chart type', async () => {
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
          title: 'Category Comparison',
          description: 'Compares values across categories.',
          trackableMetric: 'Category values',
          suggestedChartType: 'C2',
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

      fakeChartDefinitionService.setResult({
        vegaLiteConfig: { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', mark: 'bar' },
        transformInstructions: 'Group by category and sum values',
      });

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.vegaLiteConfig).toBeDefined();
        expect(result.value.dataTransformInstructions).toBe('Group by category and sum values');
      }
    });
  });

  describe('error paths', () => {
    it('returns FEED_NOT_FOUND when feed does not exist', async () => {
      const result = await generateChartDefinition('non-existent-feed', 'insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
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

      const result = await generateChartDefinition(feed?.id ?? '', 'insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }
    });

    it('returns INSIGHT_NOT_FOUND when feed has no insights', async () => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);

      const feed = feedResult.ok ? feedResult.value : null;

      const result = await generateChartDefinition(feed?.id ?? '', 'insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSIGHT_NOT_FOUND');
        expect(result.error.message).toBe('No insights available. Please analyze the feed first.');
      }
    });

    it('returns INSIGHT_NOT_FOUND when feed has empty insights array', async () => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);

      const feed = feedResult.ok ? feedResult.value : null;
      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', []);

      const result = await generateChartDefinition(feed?.id ?? '', 'insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSIGHT_NOT_FOUND');
        expect(result.error.message).toBe('No insights available. Please analyze the feed first.');
      }
    });

    it('returns INSIGHT_NOT_FOUND when insight ID does not exist', async () => {
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
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
      ];

      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);

      const result = await generateChartDefinition(feed?.id ?? '', 'non-existent-insight', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSIGHT_NOT_FOUND');
        expect(result.error.message).toBe('Insight not found: non-existent-insight');
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

      const insights: DataInsight[] = [
        {
          id: 'cf-1-insight-1',
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
      ];

      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
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

      const insights: DataInsight[] = [
        {
          id: 'cf-1-insight-1',
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
      ];

      await fakeCompositeFeedRepo.updateDataInsights(feed?.id ?? '', 'user-123', insights);
      fakeSnapshotRepo.setFailNextGet(true);

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }
    });

    it('returns INVALID_CHART_TYPE when chart type is not found', async () => {
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
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
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

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_CHART_TYPE');
        expect(result.error.message).toBe('Invalid chart type: INVALID_TYPE');
      }
    });

    it('returns GENERATION_ERROR when chart definition service fails', async () => {
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
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
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

      fakeChartDefinitionService.setError({
        code: 'GENERATION_ERROR',
        message: 'Rate limit exceeded',
      });

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('handles NO_API_KEY error from chart definition service', async () => {
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
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
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

      fakeChartDefinitionService.setError({
        code: 'NO_API_KEY',
        message: 'Please configure your Gemini API key in settings first',
      });

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toBe('Please configure your Gemini API key in settings first');
      }
    });

    it('handles PARSE_ERROR from chart definition service', async () => {
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
          title: 'Test Insight',
          description: 'Test description.',
          trackableMetric: 'Test metric',
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

      fakeChartDefinitionService.setError({
        code: 'PARSE_ERROR',
        message: 'Failed to parse LLM response: Invalid format',
      });

      const result = await generateChartDefinition(feed?.id ?? '', 'cf-1-insight-1', 'user-123', {
        compositeFeedRepository: fakeCompositeFeedRepo,
        snapshotRepository: fakeSnapshotRepo,
        chartDefinitionService: fakeChartDefinitionService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('GENERATION_ERROR');
        expect(result.error.message).toContain('Failed to parse LLM response');
      }
    });
  });

  describe('edge cases', () => {
    it('handles insights with all valid chart types', async () => {
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
          title: 'Line Chart Insight',
          description: 'For line chart.',
          trackableMetric: 'Trend',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
        {
          id: 'cf-1-insight-2',
          title: 'Bar Chart Insight',
          description: 'For bar chart.',
          trackableMetric: 'Categories',
          suggestedChartType: 'C2',
          generatedAt: new Date().toISOString(),
        },
        {
          id: 'cf-1-insight-3',
          title: 'Area Chart Insight',
          description: 'For area chart.',
          trackableMetric: 'Accumulation',
          suggestedChartType: 'C3',
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

      fakeChartDefinitionService.setResult({
        vegaLiteConfig: { mark: 'line' },
        transformInstructions: 'No transform',
      });

      for (const insight of insights) {
        const result = await generateChartDefinition(feed?.id ?? '', insight.id, 'user-123', {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          chartDefinitionService: fakeChartDefinitionService,
        });

        expect(result.ok).toBe(true);
      }
    });
  });
});
