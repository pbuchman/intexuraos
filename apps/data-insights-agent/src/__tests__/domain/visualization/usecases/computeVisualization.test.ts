import { describe, it, expect, beforeEach } from 'vitest';
import { computeVisualization } from '../../../../domain/visualization/usecases/computeVisualization.js';
import {
  FakeVisualizationRepository,
  FakeSnapshotRepository,
  FakeDataTransformService,
} from '../../../fakes.js';

describe('computeVisualization', () => {
  let fakeVizRepo: FakeVisualizationRepository;
  let fakeSnapshotRepo: FakeSnapshotRepository;
  let fakeDataTransformService: FakeDataTransformService;

  beforeEach(() => {
    fakeVizRepo = new FakeVisualizationRepository();
    fakeSnapshotRepo = new FakeSnapshotRepository();
    fakeDataTransformService = new FakeDataTransformService();
  });

  function addTestVisualization(overrides?: Partial<{ id: string; lastError: string }>): void {
    fakeVizRepo.addVisualization({
      id: overrides?.id ?? 'viz-1',
      userId: 'user-123',
      feedId: 'feed-1',
      feedName: 'Test Feed',
      insightId: 'insight-1',
      insightTitle: 'Test Insight',
      trackableMetric: 'Test Metric',
      chartConfig: { mark: 'bar' },
      transformInstructions: 'Transform data',
      chartData: null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...(overrides?.lastError !== undefined ? { lastError: overrides.lastError } : {}),
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

  describe('success paths', () => {
    it('transforms data and updates viz to ready status with chartData', async () => {
      addTestVisualization();
      await addTestSnapshot();
      fakeDataTransformService.setResult([{ category: 'Food', amount: 100 }]);

      const result = await computeVisualization('viz-1', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe('ready');
        expect(result.value.chartData).toEqual([{ category: 'Food', amount: 100 }]);
        expect(result.value.lastRefreshedAt).toBeDefined();
      }
    });

    it('clears lastError on successful computation', async () => {
      addTestVisualization({ lastError: 'Previous error' });
      await addTestSnapshot();
      fakeDataTransformService.setResult([{ value: 42 }]);

      const result = await computeVisualization('viz-1', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.lastError).toBeUndefined();
        expect(result.value.status).toBe('ready');
      }
    });
  });

  describe('error paths', () => {
    it('returns NOT_FOUND when visualization does not exist', async () => {
      const result = await computeVisualization('non-existent', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_FOUND');
        expect(result.error.message).toBe('Visualization not found');
      }
    });

    it('returns SNAPSHOT_NOT_FOUND when no snapshot for feed and updates viz to error', async () => {
      addTestVisualization();

      const result = await computeVisualization('viz-1', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('SNAPSHOT_NOT_FOUND');
        expect(result.error.message).toBe('No snapshot available. Please refresh the feed first.');
      }

      const updatedViz = fakeVizRepo.getAll().find((v) => v.id === 'viz-1');
      expect(updatedViz?.status).toBe('error');
      expect(updatedViz?.lastError).toBe('No snapshot available for this feed');
    });

    it('returns REPOSITORY_ERROR when snapshot fetch fails and updates viz to error', async () => {
      addTestVisualization();
      fakeSnapshotRepo.setFailNextGet(true);

      const result = await computeVisualization('viz-1', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }

      const updatedViz = fakeVizRepo.getAll().find((v) => v.id === 'viz-1');
      expect(updatedViz?.status).toBe('error');
      expect(updatedViz?.lastError).toBe('Snapshot fetch failed: Simulated get failure');
    });

    it('returns TRANSFORMATION_ERROR when LLM transform fails and updates viz to error', async () => {
      addTestVisualization();
      await addTestSnapshot();
      fakeDataTransformService.setError({ code: 'GENERATION_ERROR', message: 'LLM error' });

      const result = await computeVisualization('viz-1', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TRANSFORMATION_ERROR');
        expect(result.error.message).toBe('LLM error');
      }

      const updatedViz = fakeVizRepo.getAll().find((v) => v.id === 'viz-1');
      expect(updatedViz?.status).toBe('error');
      expect(updatedViz?.lastError).toBe('LLM error');
    });

    it('returns REPOSITORY_ERROR when final update fails', async () => {
      addTestVisualization();
      await addTestSnapshot();
      fakeDataTransformService.setResult([{ value: 1 }]);
      fakeVizRepo.setFailNextUpdate(true);

      const result = await computeVisualization('viz-1', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated update failure');
      }
    });

    it('returns REPOSITORY_ERROR when getById fails', async () => {
      fakeVizRepo.setFailNextGet(true);

      const result = await computeVisualization('viz-1', 'user-123', {
        visualizationRepository: fakeVizRepo,
        snapshotRepository: fakeSnapshotRepo,
        dataTransformService: fakeDataTransformService,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPOSITORY_ERROR');
        expect(result.error.message).toBe('Simulated get failure');
      }
    });
  });
});
