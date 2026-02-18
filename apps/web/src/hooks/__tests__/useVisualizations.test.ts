/**
 * Tests for useVisualizations and useCreateVisualization hooks.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useVisualizations } from '../useVisualizations.js';
import { useCreateVisualization } from '../useCreateVisualization.js';
import type { CreateVisualizationRequest, Visualization } from '../../types/index.js';

const mockGetAccessToken = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

const mockListVisualizations = vi.fn();
const mockDeleteVisualization = vi.fn();
const mockRefreshVisualization = vi.fn();
const mockCreateVisualization = vi.fn();
const mockGetVisualization = vi.fn();

vi.mock('../../services/visualizationsApi.js', () => ({
  listVisualizations: (...args: unknown[]): unknown => mockListVisualizations(...args),
  deleteVisualization: (...args: unknown[]): unknown => mockDeleteVisualization(...args),
  refreshVisualization: (...args: unknown[]): unknown => mockRefreshVisualization(...args),
  createVisualization: (...args: unknown[]): unknown => mockCreateVisualization(...args),
  getVisualization: (...args: unknown[]): unknown => mockGetVisualization(...args),
}));

const mockVisualization: Visualization = {
  id: 'viz-123',
  userId: 'user-456',
  feedId: 'feed-789',
  feedName: 'Sales Feed',
  insightId: 'insight-abc',
  insightTitle: 'Revenue Trend',
  trackableMetric: 'revenue',
  chartConfig: { type: 'line' },
  transformInstructions: 'group by month',
  chartData: [{ month: 'Jan', value: 100 }],
  status: 'ready',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('useVisualizations hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  describe('useVisualizations', () => {
    it('fetches visualizations on mount', async () => {
      mockListVisualizations.mockResolvedValue([mockVisualization]);

      const { result } = renderHook(() => useVisualizations());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockListVisualizations).toHaveBeenCalledWith('test-token');
      expect(result.current.visualizations).toHaveLength(1);
      expect(result.current.visualizations[0]).toEqual(mockVisualization);
      expect(result.current.error).toBeNull();
      expect(result.current.isRefreshing).toBe(false);
    });

    it('does not show full loading spinner during manual refresh', async () => {
      mockListVisualizations.mockResolvedValue([mockVisualization]);

      const { result } = renderHook(() => useVisualizations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockListVisualizations.mockResolvedValue([{ ...mockVisualization, insightTitle: 'Updated' }]);

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.isRefreshing).toBe(false);
      expect(result.current.visualizations[0]?.insightTitle).toBe('Updated');
    });

    it('handles fetch error', async () => {
      mockListVisualizations.mockRejectedValue(new Error('Failed to fetch'));

      const { result } = renderHook(() => useVisualizations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Failed to fetch');
      expect(result.current.visualizations).toEqual([]);
    });

    it('refreshes visualizations', async () => {
      mockListVisualizations.mockResolvedValue([mockVisualization]);

      const { result } = renderHook(() => useVisualizations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      mockListVisualizations.mockClear();
      const updatedViz = { ...mockVisualization, insightTitle: 'Updated Trend' };
      mockListVisualizations.mockResolvedValue([updatedViz]);

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockListVisualizations).toHaveBeenCalledTimes(1);
      expect(result.current.visualizations[0]?.insightTitle).toBe('Updated Trend');
    });

    it('deletes a visualization and removes it from state', async () => {
      const secondViz: Visualization = { ...mockVisualization, id: 'viz-456' };
      mockListVisualizations.mockResolvedValue([mockVisualization, secondViz]);
      mockDeleteVisualization.mockResolvedValue(undefined);

      const { result } = renderHook(() => useVisualizations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteVisualization('viz-123');
      });

      expect(mockDeleteVisualization).toHaveBeenCalledWith('test-token', 'viz-123');
      expect(result.current.visualizations).toHaveLength(1);
      expect(result.current.visualizations[0]?.id).toBe('viz-456');
    });

    it('sets error when deleteVisualization fails', async () => {
      mockListVisualizations.mockResolvedValue([mockVisualization]);
      mockDeleteVisualization.mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useVisualizations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.deleteVisualization('viz-123');
      });

      expect(result.current.error).toBe('Delete failed');
      expect(result.current.visualizations).toHaveLength(1);
    });

    it('refreshes a single visualization and updates it in state', async () => {
      mockListVisualizations.mockResolvedValue([mockVisualization]);
      const refreshedViz: Visualization = { ...mockVisualization, status: 'refreshing' };
      mockRefreshVisualization.mockResolvedValue(refreshedViz);

      const { result } = renderHook(() => useVisualizations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.refreshVisualization('viz-123');
      });

      expect(mockRefreshVisualization).toHaveBeenCalledWith('test-token', 'viz-123');
      expect(result.current.visualizations[0]?.status).toBe('refreshing');
    });

    it('sets error when refreshVisualization fails', async () => {
      mockListVisualizations.mockResolvedValue([mockVisualization]);
      mockRefreshVisualization.mockRejectedValue(new Error('Refresh failed'));

      const { result } = renderHook(() => useVisualizations());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.refreshVisualization('viz-123');
      });

      expect(result.current.error).toBe('Refresh failed');
    });

    it('polls pending/refreshing visualizations until terminal state', async () => {
      vi.useFakeTimers();
      try {
        const pendingViz: Visualization = { ...mockVisualization, id: 'viz-pending', status: 'pending' };
        const readyViz: Visualization = { ...pendingViz, status: 'ready' };

        mockListVisualizations.mockResolvedValue([pendingViz]);
        mockGetVisualization.mockResolvedValue(readyViz);

        const { result } = renderHook(() => useVisualizations());

        await act(async () => {
          await Promise.resolve();
        });

        expect(result.current.visualizations[0]?.status).toBe('pending');

        await act(async () => {
          await vi.advanceTimersByTimeAsync(4000);
        });

        expect(result.current.visualizations[0]?.status).toBe('ready');
        expect(mockGetVisualization).toHaveBeenCalledWith('test-token', 'viz-pending');
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops polling when all visualizations reach terminal state', async () => {
      vi.useFakeTimers();
      try {
        const pendingViz: Visualization = { ...mockVisualization, id: 'viz-pending', status: 'pending' };
        const readyViz: Visualization = { ...pendingViz, status: 'ready' };

        mockListVisualizations.mockResolvedValue([pendingViz]);
        mockGetVisualization.mockResolvedValue(readyViz);

        const { result } = renderHook(() => useVisualizations());

        await act(async () => {
          await Promise.resolve();
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(4000);
        });

        expect(result.current.visualizations[0]?.status).toBe('ready');

        mockGetVisualization.mockClear();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(8000);
        });

        expect(mockGetVisualization).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('useCreateVisualization', () => {
    const mockRequest: CreateVisualizationRequest = {
      feedId: 'feed-789',
      insightId: 'insight-abc',
      chartConfig: { type: 'bar' },
      transformInstructions: 'sum by category',
    };

    it('returns initial state', () => {
      const { result } = renderHook(() => useCreateVisualization());

      expect(result.current.creating).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('creates a visualization and returns it', async () => {
      mockCreateVisualization.mockResolvedValue(mockVisualization);

      const { result } = renderHook(() => useCreateVisualization());

      let viz: Visualization | null = null;
      await act(async () => {
        viz = await result.current.createVisualization(mockRequest);
      });

      expect(mockCreateVisualization).toHaveBeenCalledWith('test-token', mockRequest);
      expect(viz).toEqual(mockVisualization);
      expect(result.current.creating).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('sets creating to true while in progress', async () => {
      let resolveCreate!: (value: Visualization) => void;
      mockCreateVisualization.mockReturnValue(
        new Promise<Visualization>((resolve) => {
          resolveCreate = resolve;
        })
      );

      const { result } = renderHook(() => useCreateVisualization());

      act(() => {
        void result.current.createVisualization(mockRequest);
      });

      await waitFor(() => {
        expect(result.current.creating).toBe(true);
      });

      await act(async () => {
        resolveCreate(mockVisualization);
      });

      expect(result.current.creating).toBe(false);
    });

    it('returns null and sets error when creation fails', async () => {
      mockCreateVisualization.mockRejectedValue(new Error('Creation failed'));

      const { result } = renderHook(() => useCreateVisualization());

      let viz: Visualization | null = mockVisualization;
      await act(async () => {
        viz = await result.current.createVisualization(mockRequest);
      });

      expect(viz).toBeNull();
      expect(result.current.error).toBe('Creation failed');
      expect(result.current.creating).toBe(false);
    });

    it('clears previous error on new create attempt', async () => {
      mockCreateVisualization.mockRejectedValueOnce(new Error('First error'));
      mockCreateVisualization.mockResolvedValueOnce(mockVisualization);

      const { result } = renderHook(() => useCreateVisualization());

      await act(async () => {
        await result.current.createVisualization(mockRequest);
      });

      expect(result.current.error).toBe('First error');

      await act(async () => {
        await result.current.createVisualization(mockRequest);
      });

      expect(result.current.error).toBeNull();
    });
  });
});
