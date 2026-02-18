import { describe, it, expect, beforeEach } from 'vitest';
import { getVisualization } from '../../../../domain/visualization/usecases/getVisualization.js';
import { FakeVisualizationRepository } from '../../../fakes.js';

describe('getVisualization', () => {
  let fakeVizRepo: FakeVisualizationRepository;

  beforeEach(() => {
    fakeVizRepo = new FakeVisualizationRepository();
  });

  it('returns visualization by id and userId', async () => {
    fakeVizRepo.addVisualization({
      id: 'viz-1',
      userId: 'user-123',
      feedId: 'feed-1',
      feedName: 'Test Feed',
      insightId: 'insight-1',
      insightTitle: 'Test Insight',
      trackableMetric: 'Test Metric',
      chartConfig: { mark: 'bar' },
      transformInstructions: 'Transform data',
      chartData: [{ value: 42 }],
      status: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await getVisualization('viz-1', 'user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe('viz-1');
      expect(result.value.userId).toBe('user-123');
      expect(result.value.feedName).toBe('Test Feed');
      expect(result.value.chartData).toEqual([{ value: 42 }]);
    }
  });

  it('returns NOT_FOUND when visualization does not exist', async () => {
    const result = await getVisualization('non-existent', 'user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_FOUND');
      expect(result.error.message).toBe('Visualization not found');
    }
  });

  it('returns REPOSITORY_ERROR when repository fails', async () => {
    fakeVizRepo.setFailNextGet(true);

    const result = await getVisualization('viz-1', 'user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('REPOSITORY_ERROR');
      expect(result.error.message).toBe('Simulated get failure');
    }
  });
});
