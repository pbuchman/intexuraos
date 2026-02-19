import { describe, it, expect, beforeEach } from 'vitest';
import { refreshFeedVisualizations } from '../../../../domain/visualization/usecases/refreshFeedVisualizations.js';
import {
  FakeVisualizationRepository,
  FakeSnapshotRepository,
  FakeDataTransformService,
  FakeLogger,
} from '../../../fakes.js';

describe('refreshFeedVisualizations', () => {
  let fakeVizRepo: FakeVisualizationRepository;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeDataTransformService: FakeDataTransformService;
  let fakeLogger: FakeLogger;

  beforeEach(() => {
    fakeVizRepo = new FakeVisualizationRepository();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeDataTransformService = new FakeDataTransformService();
    fakeLogger = new FakeLogger();
  });

  function addVisualization(id: string): void {
    fakeVizRepo.addVisualization({
      id,
      userId: 'user-123',
      feedId: 'feed-1',
      feedName: 'Test Feed',
      insightId: `insight-${id}`,
      insightTitle: `Insight ${id}`,
      trackableMetric: `Metric ${id}`,
      chartConfig: { mark: 'bar' },
      transformInstructions: 'Transform data',
      chartData: null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async function addTestSnapshot(): Promise<void> {
    await fakeSnapshotRepo.upsert('feed-1', 'user-123', 'Test Feed', {
      feedId: 'feed-1',
      feedName: 'Test Feed',
      purpose: 'Test',
      generatedAt: new Date().toISOString(),
      staticSources: [],
      notifications: [],
    });
  }

  function getDeps(): { visualizationRepository: FakeVisualizationRepository; snapshotRepository: FakeSnapshotRepository; dataTransformService: FakeDataTransformService; logger: FakeLogger } {
    return {
      visualizationRepository: fakeVizRepo,
      snapshotRepository: fakeSnapshotRepo,
      dataTransformService: fakeDataTransformService,
      logger: fakeLogger,
    };
  }

  it('returns {refreshed:0, failed:0, errors:[]} when no visualizations exist', async () => {
    await addTestSnapshot();

    const result = await refreshFeedVisualizations('feed-1', 'user-123', getDeps());

    expect(result).toEqual({ refreshed: 0, failed: 0, errors: [] });
  });

  it('refreshes all visualizations successfully', async () => {
    addVisualization('viz-a');
    addVisualization('viz-b');
    await addTestSnapshot();

    const result = await refreshFeedVisualizations('feed-1', 'user-123', getDeps());

    expect(result.refreshed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);

    const allVizs = fakeVizRepo.getAll();
    for (const viz of allVizs) {
      expect(viz.status).toBe('ready');
      expect(viz.lastRefreshedAt).toBeDefined();
    }
  });

  it('handles partial failure (one succeeds, one fails transform)', async () => {
    addVisualization('viz-a');
    addVisualization('viz-b');
    await addTestSnapshot();

    fakeDataTransformService.setResult([{ value: 1 }]);
    fakeDataTransformService.setError({ code: 'GENERATION_ERROR', message: 'LLM error on second' });

    const result = await refreshFeedVisualizations('feed-1', 'user-123', getDeps());

    expect(result.refreshed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toBe('LLM error on second');
  });

  it('handles list failure (listByFeedId fails)', async () => {
    fakeVizRepo.setFailNextListByFeed(true);

    const result = await refreshFeedVisualizations('feed-1', 'user-123', getDeps());

    expect(result.refreshed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.vizId).toBe('list');
    expect(result.errors[0]?.error).toBe('Simulated list by feed failure');
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it('handles no snapshot (returns {refreshed:0, failed:0, errors:[]})', async () => {
    addVisualization('viz-a');

    const result = await refreshFeedVisualizations('feed-1', 'user-123', getDeps());

    expect(result).toEqual({ refreshed: 0, failed: 0, errors: [] });
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('handles snapshot fetch failure (returns {refreshed:0, failed:0, errors:[]})', async () => {
    addVisualization('viz-a');
    fakeSnapshotRepo.setFailNextGet(true);

    const result = await refreshFeedVisualizations('feed-1', 'user-123', getDeps());

    expect(result).toEqual({ refreshed: 0, failed: 0, errors: [] });
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
