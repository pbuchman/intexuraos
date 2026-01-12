import { useCallback, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { previewChart as previewChartApi } from '@/services/dataInsightsApi';
import type { PreviewChartRequest } from '@/services/dataInsightsApi';

interface UseChartPreviewResult {
  chartData: unknown[] | null;
  previewing: boolean;
  error: string | null;
  generatePreview: (request: PreviewChartRequest) => Promise<void>;
  clearPreview: () => void;
}

/**
 * Hook for generating chart preview data.
 * Transforms snapshot data according to chart configuration for Vega-Lite rendering.
 */
export function useChartPreview(feedId: string): UseChartPreviewResult {
  const { getAccessToken } = useAuth();
  const [chartData, setChartData] = useState<unknown[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatePreview = useCallback(
    async (request: PreviewChartRequest): Promise<void> => {
      if (feedId === '') {
        throw new Error('No feed ID provided');
      }

      setPreviewing(true);
      setError(null);

      try {
        const token = await getAccessToken();
        const response = await previewChartApi(token, feedId, request);
        setChartData(response.chartData);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to generate preview'));
        setChartData(null);
      } finally {
        setPreviewing(false);
      }
    },
    [feedId, getAccessToken]
  );

  const clearPreview = useCallback((): void => {
    setChartData(null);
    setError(null);
  }, []);

  return {
    chartData,
    previewing,
    error,
    generatePreview,
    clearPreview,
  };
}
