import { describe, it, expect, beforeEach } from 'vitest';
import { createVisualization } from '../../../../domain/visualization/usecases/createVisualization.js';
import { MAX_VISUALIZATIONS_PER_FEED } from '../../../../domain/visualization/models/index.js';
import {
  FakeCompositeFeedRepository,
  FakeVisualizationRepository,
} from '../../../fakes.js';

describe('createVisualization', () => {
  let fakeCompositeFeedRepo: FakeCompositeFeedRepository;
  let fakeVizRepo: FakeVisualizationRepository;

  beforeEach(() => {
    fakeCompositeFeedRepo = new FakeCompositeFeedRepository();
    fakeVizRepo = new FakeVisualizationRepository();
  });

  async function createFeedWithInsights(): Promise<{ feedId: string; insightId: string }> {
    const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
      purpose: 'Test purpose',
      staticSourceIds: [],
      notificationFilters: [],
    });
    expect(feedResult.ok).toBe(true);
    const feedId = feedResult.ok ? feedResult.value.id : '';
    const insightId = `${feedId}-insight-1`;

    await fakeCompositeFeedRepo.updateDataInsights(feedId, 'user-123', [
      {
        id: insightId,
        title: 'Test Insight',
        description: 'Test description',
        trackableMetric: 'Test metric',
        suggestedChartType: 'C1',
        generatedAt: new Date().toISOString(),
      },
    ]);

    return { feedId, insightId };
  }

  describe('success paths', () => {
    it('creates visualization with pending status and null chartData', async () => {
      const feed = await createFeedWithInsights();

      const result = await createVisualization('user-123', {
        feedId: feed.feedId,
        insightId: `${feed.feedId}-insight-1`,
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Transform the data',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('pending');
        expect(result.value.chartData).toBeNull();
        expect(result.value.userId).toBe('user-123');
        expect(result.value.feedId).toBe(feed.feedId);
        expect(result.value.chartConfig).toEqual({ mark: 'bar' });
        expect(result.value.transformInstructions).toBe('Transform the data');
        expect(result.value.id).toBeDefined();
        expect(result.value.createdAt).toBeDefined();
        expect(result.value.updatedAt).toBeDefined();
      }
    });

    it('denormalizes feedName, insightTitle, trackableMetric from feed', async () => {
      const feed = await createFeedWithInsights();

      const result = await createVisualization('user-123', {
        feedId: feed.feedId,
        insightId: `${feed.feedId}-insight-1`,
        chartConfig: { mark: 'line' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.feedName).toBe('Test Feed');
        expect(result.value.insightTitle).toBe('Test Insight');
        expect(result.value.trackableMetric).toBe('Test metric');
      }
    });
  });

  describe('error paths', () => {
    it('returns FEED_NOT_FOUND when feed does not exist', async () => {
      const result = await createVisualization('user-123', {
        feedId: 'non-existent-feed',
        insightId: 'some-insight',
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('FEED_NOT_FOUND');
        expect(result.error.message).toBe('Composite feed not found');
      }
    });

    it('returns INSIGHT_NOT_FOUND when feed has no insights (dataInsights === null)', async () => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feedId = feedResult.ok ? feedResult.value.id : '';

      const result = await createVisualization('user-123', {
        feedId,
        insightId: 'some-insight',
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSIGHT_NOT_FOUND');
        expect(result.error.message).toBe('No insights available. Please analyze the feed first.');
      }
    });

    it('returns INSIGHT_NOT_FOUND when insightId does not match any insight', async () => {
      const feed = await createFeedWithInsights();

      const result = await createVisualization('user-123', {
        feedId: feed.feedId,
        insightId: 'wrong-insight-id',
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSIGHT_NOT_FOUND');
        expect(result.error.message).toBe('Insight not found: wrong-insight-id');
      }
    });

    it('returns INSIGHT_NOT_FOUND when feed has empty dataInsights array', async () => {
      const feedResult = await fakeCompositeFeedRepo.create('user-123', 'Test Feed', {
        purpose: 'Test purpose',
        staticSourceIds: [],
        notificationFilters: [],
      });
      expect(feedResult.ok).toBe(true);
      const feedId = feedResult.ok ? feedResult.value.id : '';

      await fakeCompositeFeedRepo.updateDataInsights(feedId, 'user-123', []);

      const result = await createVisualization('user-123', {
        feedId,
        insightId: 'some-insight',
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSIGHT_NOT_FOUND');
        expect(result.error.message).toBe('No insights available. Please analyze the feed first.');
      }
    });

    it('returns LIMIT_EXCEEDED when MAX_VISUALIZATIONS_PER_FEED reached', async () => {
      const feed = await createFeedWithInsights();
      const feedId = feed.feedId;

      for (let i = 0; i < MAX_VISUALIZATIONS_PER_FEED; i++) {
        fakeVizRepo.addVisualization({
          id: `viz-existing-${String(i)}`,
          userId: 'user-123',
          feedId,
          feedName: 'Test Feed',
          insightId: `${feedId}-insight-1`,
          insightTitle: 'Test Insight',
          trackableMetric: 'Test metric',
          chartConfig: { mark: 'bar' },
          transformInstructions: 'Instructions',
          chartData: null,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      const result = await createVisualization('user-123', {
        feedId,
        insightId: `${feedId}-insight-1`,
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LIMIT_EXCEEDED');
        expect(result.error.message).toBe(`Maximum of ${String(MAX_VISUALIZATIONS_PER_FEED)} visualizations per feed reached`);
      }
    });

    it('returns REPOSITORY_ERROR when compositeFeedRepository.getById fails', async () => {
      fakeCompositeFeedRepo.setFailNextGet(true);

      const result = await createVisualization('user-123', {
        feedId: 'feed-1',
        insightId: 'insight-1',
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }
    });

    it('returns REPOSITORY_ERROR when visualizationRepository.listByFeedId fails', async () => {
      const feed = await createFeedWithInsights();
      fakeVizRepo.setFailNextListByFeed(true);

      const result = await createVisualization('user-123', {
        feedId: feed.feedId,
        insightId: `${feed.feedId}-insight-1`,
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated list by feed failure');
      }
    });

    it('returns REPOSITORY_ERROR when visualizationRepository.create fails', async () => {
      const feed = await createFeedWithInsights();
      fakeVizRepo.setFailNextCreate(true);

      const result = await createVisualization('user-123', {
        feedId: feed.feedId,
        insightId: `${feed.feedId}-insight-1`,
        chartConfig: { mark: 'bar' },
        transformInstructions: 'Instructions',
      }, {
        compositeFeedRepository: fakeCompositeFeedRepo,
        visualizationRepository: fakeVizRepo,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated create failure');
      }
    });
  });
});
