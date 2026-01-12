import { describe, it, expect, beforeEach } from 'vitest';
import { transformDataForPreview } from '../../../../domain/dataInsights/usecases/transformDataForPreview.js';
import {
  FakeCompositeFeedRepository,
  FakeSnapshotRepository,
  FakeDataTransformService,
} from '../../../fakes.js';
import type { DataInsight } from '../../../../domain/dataInsights/types.js';

describe('transformDataForPreview', () => {
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeDataTransformService: FakeDataTransformService;

  beforeEach(() => {
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeDataTransformService = new FakeDataTransformService();
  });

  describe('success paths', () => {
    it('transforms data successfully for preview', async () => {
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

      const transformedData = [
        { date: '2025-01-01', value: 10 },
        { date: '2025-01-02', value: 20 },
        { date: '2025-01-03', value: 30 },
      ];

      fakeDataTransformService.setResult(transformedData);

      const chartConfig = {
        $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
        mark: 'line',
        encoding: {
          x: { field: 'date' },
          y: { field: 'value' },
        },
      };

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig,
          transformInstructions: 'Filter to last 7 days and sort by date ascending',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(transformedData);
      }
    });

    it('handles single data item', async () => {
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
          title: 'Single Data Point',
          description: 'Only one data point.',
          trackableMetric: 'Value',
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

      const transformedData = [{ date: '2025-01-01', value: 10 }];
      fakeDataTransformService.setResult(transformedData);

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: { mark: 'line' },
          transformInstructions: 'No transform needed',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]).toEqual({ date: '2025-01-01', value: 10 });
      }
    });

    it('handles complex nested data structures', async () => {
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
          title: 'Complex Data',
          description: 'Nested structure.',
          trackableMetric: 'Complex metric',
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

      const transformedData = [
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

      fakeDataTransformService.setResult(transformedData);

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: { mark: 'line' },
          transformInstructions: 'No transform needed',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const item = result.value[0] as { date: string; value: number; metadata: { source: string; verified: boolean } };
        expect(item.metadata).toEqual({ source: 'api', verified: true });
      }
    });
  });

  describe('error paths', () => {
    it('returns FEED_NOT_FOUND when feed does not exist', async () => {
      const result = await transformDataForPreview(
        'non-existent-feed',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

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

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

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

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

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

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

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

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'non-existent-insight',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

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

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

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

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }
    });

    it('returns TRANSFORMATION_ERROR when data transform service fails', async () => {
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

      fakeDataTransformService.setError({
        code: 'GENERATION_ERROR',
        message: 'Rate limit exceeded',
      });

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TRANSFORMATION_ERROR');
        expect(result.error.message).toBe('Rate limit exceeded');
      }
    });

    it('handles NO_API_KEY error from data transform service', async () => {
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

      fakeDataTransformService.setError({
        code: 'NO_API_KEY',
        message: 'Please configure your Gemini API key in settings first',
      });

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TRANSFORMATION_ERROR');
        expect(result.error.message).toBe('Please configure your Gemini API key in settings first');
      }
    });

    it('handles PARSE_ERROR from data transform service', async () => {
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

      fakeDataTransformService.setError({
        code: 'PARSE_ERROR',
        message: 'Failed to parse LLM response: Invalid format',
      });

      const result = await transformDataForPreview(
        feed?.id ?? '',
        'user-123',
        {
          chartConfig: {},
          transformInstructions: 'Test',
          insightId: 'cf-1-insight-1',
        },
        {
          compositeFeedRepository: fakeCompositeFeedRepo,
          snapshotRepository: fakeSnapshotRepo,
          dataTransformService: fakeDataTransformService,
        }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TRANSFORMATION_ERROR');
        expect(result.error.message).toContain('Failed to parse LLM response');
      }
    });
  });

  describe('edge cases', () => {
    it('handles multiple insights on the same feed', async () => {
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
          title: 'First Insight',
          description: 'First.',
          trackableMetric: 'Metric 1',
          suggestedChartType: 'C1',
          generatedAt: new Date().toISOString(),
        },
        {
          id: 'cf-1-insight-2',
          title: 'Second Insight',
          description: 'Second.',
          trackableMetric: 'Metric 2',
          suggestedChartType: 'C2',
          generatedAt: new Date().toISOString(),
        },
        {
          id: 'cf-1-insight-3',
          title: 'Third Insight',
          description: 'Third.',
          trackableMetric: 'Metric 3',
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

      fakeDataTransformService.setResult([{ date: '2025-01-01', value: 10 }]);

      for (const insight of insights) {
        const result = await transformDataForPreview(
          feed?.id ?? '',
          'user-123',
          {
            chartConfig: { mark: 'line' },
            transformInstructions: 'No transform',
            insightId: insight.id,
          },
          {
            compositeFeedRepository: fakeCompositeFeedRepo,
            snapshotRepository: fakeSnapshotRepo,
            dataTransformService: fakeDataTransformService,
          }
        );

        expect(result.ok).toBe(true);
      }
    });
  });
});
