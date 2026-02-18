import { describe, it, expect, beforeEach } from 'vitest';
import { deleteVisualization } from '../../../../domain/visualization/usecases/deleteVisualization.js';
import { FakeVisualizationRepository } from '../../../fakes.js';

describe('deleteVisualization', () => {
  let fakeVizRepo: FakeVisualizationRepository;

  beforeEach(() => {
    fakeVizRepo = new FakeVisualizationRepository();
  });

  it('deletes visualization successfully', async () => {
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
      chartData: null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await deleteVisualization('viz-1', 'user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(true);
    expect(fakeVizRepo.getAll()).toHaveLength(0);
  });

  it('returns error when repository fails', async () => {
    fakeVizRepo.setFailNextDelete(true);

    const result = await deleteVisualization('viz-1', 'user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Simulated delete failure');
    }
  });
});
