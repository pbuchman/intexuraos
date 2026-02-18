import { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listVisualizations as listVisualizationsApi,
  getVisualization as getVisualizationApi,
  deleteVisualization as deleteVisualizationApi,
  refreshVisualization as refreshVisualizationApi,
} from '@/services/visualizationsApi.js';
import type { Visualization } from '@/types';

interface UseVisualizationsResult {
  visualizations: Visualization[];
  loading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  deleteVisualization: (id: string) => Promise<void>;
  refreshVisualization: (id: string) => Promise<void>;
}

export function useVisualizations(): UseVisualizationsResult {
  const { getAccessToken } = useAuth();
  const [visualizations, setVisualizations] = useState<Visualization[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVisualizations = useCallback(async (showFullLoader: boolean): Promise<void> => {
    if (showFullLoader) {
      setLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      const token = await getAccessToken();
      const result = await listVisualizationsApi(token);
      setVisualizations(result);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load visualizations'));
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void loadVisualizations(true);
  }, [loadVisualizations]);

  const refresh = useCallback(async (): Promise<void> => {
    await loadVisualizations(false);
  }, [loadVisualizations]);

  const hasInProgress = useMemo(
    () => visualizations.some((v) => v.status === 'pending' || v.status === 'refreshing'),
    [visualizations]
  );

  useEffect(() => {
    if (!hasInProgress) return;

    const interval = setInterval(() => {
      void (async (): Promise<void> => {
        try {
          const token = await getAccessToken();
          const inProgress = visualizations.filter(
            (v) => v.status === 'pending' || v.status === 'refreshing'
          );
          const updates = await Promise.all(
            inProgress.map((v) => getVisualizationApi(token, v.id).catch(() => null))
          );
          setVisualizations((prev) =>
            prev.map((v) => {
              const updated = updates.find((u) => u !== null && u.id === v.id);
              return updated ?? v;
            })
          );
        } catch {
          // polling errors are non-fatal
        }
      })();
    }, 4000);

    return (): void => {
      clearInterval(interval);
    };
  }, [hasInProgress, getAccessToken, visualizations]);

  const deleteViz = useCallback(
    async (id: string): Promise<void> => {
      try {
        const token = await getAccessToken();
        await deleteVisualizationApi(token, id);
        setVisualizations((prev) => prev.filter((v) => v.id !== id));
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to delete visualization'));
      }
    },
    [getAccessToken]
  );

  const refreshViz = useCallback(
    async (id: string): Promise<void> => {
      try {
        const token = await getAccessToken();
        const updated = await refreshVisualizationApi(token, id);
        setVisualizations((prev) => prev.map((v) => (v.id === id ? updated : v)));
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to refresh visualization'));
      }
    },
    [getAccessToken]
  );

  return {
    visualizations,
    loading,
    isRefreshing,
    error,
    refresh,
    deleteVisualization: deleteViz,
    refreshVisualization: refreshViz,
  };
}
