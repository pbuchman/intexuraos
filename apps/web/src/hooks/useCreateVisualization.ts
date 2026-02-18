import { useCallback, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { createVisualization as createVisualizationApi } from '@/services/visualizationsApi.js';
import type { CreateVisualizationRequest, Visualization } from '@/types';

interface UseCreateVisualizationResult {
  creating: boolean;
  error: string | null;
  createVisualization: (request: CreateVisualizationRequest) => Promise<Visualization | null>;
}

export function useCreateVisualization(): UseCreateVisualizationResult {
  const { getAccessToken } = useAuth();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (request: CreateVisualizationRequest): Promise<Visualization | null> => {
      setCreating(true);
      setError(null);
      try {
        const token = await getAccessToken();
        const viz = await createVisualizationApi(token, request);
        return viz;
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to create visualization'));
        return null;
      } finally {
        setCreating(false);
      }
    },
    [getAccessToken]
  );

  return {
    creating,
    error,
    createVisualization: create,
  };
}
