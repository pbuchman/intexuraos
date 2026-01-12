import { useCallback, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { analyzeCompositeFeed as analyzeCompositeFeedApi } from '@/services/dataInsightsApi';
import type { DataInsight } from '@/types';

interface UseDataInsightsResult {
  insights: DataInsight[] | null;
  noInsightsReason: string | null;
  analyzing: boolean;
  error: string | null;
  analyzeData: () => Promise<void>;
}

/**
 * Hook for managing data insights analysis.
 * Triggers LLM analysis to generate up to 5 insights from composite feed snapshot.
 */
export function useDataInsights(feedId: string, existingInsights: DataInsight[] | null): UseDataInsightsResult {
  const { getAccessToken } = useAuth();
  const [insights, setInsights] = useState<DataInsight[] | null>(existingInsights);
  const [noInsightsReason, setNoInsightsReason] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeData = useCallback(async (): Promise<void> => {
    if (feedId === '') {
      throw new Error('No feed ID provided');
    }

    setAnalyzing(true);
    setError(null);
    setNoInsightsReason(null);

    try {
      const token = await getAccessToken();
      const response = await analyzeCompositeFeedApi(token, feedId);

      setInsights(response.insights);
      setNoInsightsReason(response.noInsightsReason ?? null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to analyze data'));
      setInsights(null);
    } finally {
      setAnalyzing(false);
    }
  }, [feedId, getAccessToken]);

  return {
    insights,
    noInsightsReason,
    analyzing,
    error,
    analyzeData,
  };
}
