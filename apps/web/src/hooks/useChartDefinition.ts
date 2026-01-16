import { useCallback, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { generateChartDefinition as generateChartDefinitionApi } from '@/services/dataInsightsApi';
import type { ChartDefinition } from '@/services/dataInsightsApi';

interface UseChartDefinitionResult {
  chartDefinition: ChartDefinition | null;
  generating: boolean;
  error: string | null;
  generateDefinition: (insightId: string) => Promise<void>;
  clearDefinition: () => void;
}

/**
 * Hook for managing ephemeral chart definitions.
 * Chart definitions are NOT persisted - they're stored in React state and lost on page refresh.
 */
export function useChartDefinition(feedId: string): UseChartDefinitionResult {
  const { getAccessToken } = useAuth();
  const [chartDefinition, setChartDefinition] = useState<ChartDefinition | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateDefinition = useCallback(
    async (insightId: string): Promise<void> => {
      if (feedId === '') {
        throw new Error('No feed ID provided');
      }

      setGenerating(true);
      setError(null);

      try {
        const token = await getAccessToken();
        // eslint-disable-next-line no-console -- temporary debug
        console.log('[useChartDefinition] Calling API for insightId:', insightId);
        const definition = await generateChartDefinitionApi(token, feedId, insightId);
        // eslint-disable-next-line no-console -- temporary debug
        console.log('[useChartDefinition] API returned:', definition);
        setChartDefinition(definition);
        // eslint-disable-next-line no-console -- temporary debug
        console.log('[useChartDefinition] State set successfully');
      } catch (err) {
        // eslint-disable-next-line no-console -- temporary debug
        console.error('[useChartDefinition] Error:', err);
        setError(getErrorMessage(err, 'Failed to generate chart definition'));
        setChartDefinition(null);
      } finally {
        setGenerating(false);
      }
    },
    [feedId, getAccessToken]
  );

  const clearDefinition = useCallback((): void => {
    setChartDefinition(null);
    setError(null);
  }, []);

  return {
    chartDefinition,
    generating,
    error,
    generateDefinition,
    clearDefinition,
  };
}
