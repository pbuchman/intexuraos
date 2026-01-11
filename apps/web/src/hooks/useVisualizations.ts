import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  createVisualization as createVisualizationApi,
  deleteVisualization as deleteVisualizationApi,
  getVisualization as getVisualizationApi,
  listVisualizations as listVisualizationsApi,
  updateVisualization as updateVisualizationApi,
  regenerateVisualization as regenerateVisualizationApi,
} from '@/services/visualizationApi';
import type {
  Visualization,
  CreateVisualizationRequest,
  UpdateVisualizationRequest,
} from '@/types';

interface UseVisualizationsResult {
  visualizations: Visualization[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createVisualization: (request: CreateVisualizationRequest) => Promise<Visualization>;
  deleteVisualization: (visualizationId: string) => Promise<void>;
  updateVisualization: (
    visualizationId: string,
    request: UpdateVisualizationRequest
  ) => Promise<Visualization>;
  regenerateVisualization: (visualizationId: string) => Promise<Visualization>;
}

export function useVisualizations(feedId: string): UseVisualizationsResult {
  const { getAccessToken } = useAuth();
  const [visualizations, setVisualizations] = useState<Visualization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (feedId === '') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listVisualizationsApi(token, feedId);
      setVisualizations(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load visualizations'));
    } finally {
      setLoading(false);
    }
  }, [feedId, getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createVisualization = useCallback(
    async (request: CreateVisualizationRequest): Promise<Visualization> => {
      const token = await getAccessToken();
      const newVisualization = await createVisualizationApi(token, feedId, request);
      setVisualizations((prev) => [newVisualization, ...prev]);
      return newVisualization;
    },
    [feedId, getAccessToken]
  );

  const deleteVisualization = useCallback(
    async (visualizationId: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteVisualizationApi(token, feedId, visualizationId);
      setVisualizations((prev) => prev.filter((viz) => viz.id !== visualizationId));
    },
    [feedId, getAccessToken]
  );

  const updateVisualization = useCallback(
    async (
      visualizationId: string,
      request: UpdateVisualizationRequest
    ): Promise<Visualization> => {
      const token = await getAccessToken();
      const updated = await updateVisualizationApi(token, feedId, visualizationId, request);
      setVisualizations((prev) =>
        prev.map((viz) => (viz.id === visualizationId ? updated : viz))
      );
      return updated;
    },
    [feedId, getAccessToken]
  );

  const regenerateVisualization = useCallback(
    async (visualizationId: string): Promise<Visualization> => {
      const token = await getAccessToken();
      const regenerated = await regenerateVisualizationApi(token, feedId, visualizationId);
      setVisualizations((prev) =>
        prev.map((viz) => (viz.id === visualizationId ? regenerated : viz))
      );
      return regenerated;
    },
    [feedId, getAccessToken]
  );

  return {
    visualizations,
    loading,
    error,
    refresh,
    createVisualization,
    deleteVisualization,
    updateVisualization,
    regenerateVisualization,
  };
}

interface UseVisualizationResult {
  visualization: Visualization | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateVisualization: (request: UpdateVisualizationRequest) => Promise<Visualization>;
  regenerateVisualization: () => Promise<Visualization>;
}

export function useVisualization(
  feedId: string,
  visualizationId: string
): UseVisualizationResult {
  const { getAccessToken } = useAuth();
  const [visualization, setVisualization] = useState<Visualization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (feedId === '' || visualizationId === '') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await getVisualizationApi(token, feedId, visualizationId);
      setVisualization(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load visualization'));
    } finally {
      setLoading(false);
    }
  }, [feedId, visualizationId, getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateVisualization = useCallback(
    async (request: UpdateVisualizationRequest): Promise<Visualization> => {
      if (feedId === '' || visualizationId === '') {
        throw new Error('No feed ID or visualization ID');
      }

      const token = await getAccessToken();
      const updated = await updateVisualizationApi(token, feedId, visualizationId, request);
      setVisualization(updated);
      return updated;
    },
    [feedId, visualizationId, getAccessToken]
  );

  const regenerateVisualization = useCallback(async (): Promise<Visualization> => {
    if (feedId === '' || visualizationId === '') {
      throw new Error('No feed ID or visualization ID');
    }

    const token = await getAccessToken();
    const regenerated = await regenerateVisualizationApi(token, feedId, visualizationId);
    setVisualization(regenerated);
    return regenerated;
  }, [feedId, visualizationId, getAccessToken]);

  return {
    visualization,
    loading,
    error,
    refresh,
    updateVisualization,
    regenerateVisualization,
  };
}
