import { describe, it, expect, beforeEach } from 'vitest';
import { listVisualizations } from '../../../../domain/visualization/usecases/listVisualizations.js';
import { FakeVisualizationRepository } from '../../../fakes.js';

describe('listVisualizations', () => {
  let fakeVizRepo: FakeVisualizationRepository;

  beforeEach(() => {
    fakeVizRepo = new FakeVisualizationRepository();
  });

  it('returns list of user visualizations', async () => {
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
      chartData: [{ value: 1 }],
      status: 'ready',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    fakeVizRepo.addVisualization({
      id: 'viz-2',
      userId: 'user-123',
      feedId: 'feed-1',
      feedName: 'Test Feed',
      insightId: 'insight-2',
      insightTitle: 'Another Insight',
      trackableMetric: 'Another Metric',
      chartConfig: { mark: 'line' },
      transformInstructions: 'Other instructions',
      chartData: null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await listVisualizations('user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('returns empty array when no visualizations', async () => {
    const result = await listVisualizations('user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('returns error when repository fails', async () => {
    fakeVizRepo.setFailNextList(true);

    const result = await listVisualizations('user-123', {
      visualizationRepository: fakeVizRepo,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Simulated list failure');
    }
  });
});
