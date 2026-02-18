import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createVisualization,
  listVisualizations,
  getVisualization,
  deleteVisualization,
  refreshVisualization,
} from '../visualizationsApi'; // @allow-missing-js -- Vite web app, not Node ESM; .js extensions not required
import type { Visualization, CreateVisualizationRequest } from '../../types'; // @allow-missing-js -- Vite web app, not Node ESM; .js extensions not required

vi.mock('../apiClient.js', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: {
    dataInsightsAgentUrl: 'https://data-insights.test',
  },
}));

describe('visualizationsApi', () => {
  const mockAccessToken = 'test-access-token';

  const mockVisualization: Visualization = {
    id: 'viz-123',
    userId: 'user-456',
    feedId: 'feed-789',
    feedName: 'Test Feed',
    insightId: 'insight-abc',
    insightTitle: 'Test Insight',
    trackableMetric: 'revenue',
    chartConfig: { type: 'bar' },
    transformInstructions: 'Group by month',
    chartData: null,
    status: 'pending',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createVisualization', () => {
    it('posts a new visualization with the given request', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(mockVisualization);

      const request: CreateVisualizationRequest = {
        feedId: 'feed-789',
        insightId: 'insight-abc',
        chartConfig: { type: 'bar' },
        transformInstructions: 'Group by month',
      };

      const result = await createVisualization(mockAccessToken, request);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://data-insights.test',
        '/visualizations',
        mockAccessToken,
        {
          method: 'POST',
          body: request,
        }
      );
      expect(result).toEqual(mockVisualization);
    });
  });

  describe('listVisualizations', () => {
    it('fetches all visualizations', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const mockResponse: Visualization[] = [mockVisualization];
      vi.mocked(apiRequest).mockResolvedValue(mockResponse);

      const result = await listVisualizations(mockAccessToken);

      expect(apiRequest).toHaveBeenCalledWith(
        'https://data-insights.test',
        '/visualizations',
        mockAccessToken
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getVisualization', () => {
    it('fetches a single visualization by ID', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue(mockVisualization);

      const result = await getVisualization(mockAccessToken, 'viz-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://data-insights.test',
        '/visualizations/viz-123',
        mockAccessToken
      );
      expect(result).toEqual(mockVisualization);
    });
  });

  describe('deleteVisualization', () => {
    it('sends a DELETE request for the given visualization ID', async () => {
      const { apiRequest } = await import('../apiClient.js');
      vi.mocked(apiRequest).mockResolvedValue({});

      await deleteVisualization(mockAccessToken, 'viz-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://data-insights.test',
        '/visualizations/viz-123',
        mockAccessToken,
        {
          method: 'DELETE',
        }
      );
    });
  });

  describe('refreshVisualization', () => {
    it('posts to the refresh endpoint for the given visualization ID', async () => {
      const { apiRequest } = await import('../apiClient.js');
      const refreshedVisualization: Visualization = {
        ...mockVisualization,
        status: 'refreshing',
        updatedAt: '2024-01-02T00:00:00Z',
      };
      vi.mocked(apiRequest).mockResolvedValue(refreshedVisualization);

      const result = await refreshVisualization(mockAccessToken, 'viz-123');

      expect(apiRequest).toHaveBeenCalledWith(
        'https://data-insights.test',
        '/visualizations/viz-123/refresh',
        mockAccessToken,
        {
          method: 'POST',
        }
      );
      expect(result).toEqual(refreshedVisualization);
    });
  });
});
