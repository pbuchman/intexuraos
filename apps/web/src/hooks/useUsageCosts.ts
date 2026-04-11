import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getUsageCosts as getUsageCostsApi } from '@/services/settingsApi';
import type { AggregatedCosts } from '@/types';

interface UseUsageCostsResult {
  costs: AggregatedCosts | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const DEFAULT_DAYS = 90;

export function useUsageCosts(days: number = DEFAULT_DAYS): UseUsageCostsResult {
  const { getAccessToken } = useAuth();
  const [costs, setCosts] = useState<AggregatedCosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await getUsageCostsApi(token, days);
      setCosts(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load usage costs'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, days]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    costs,
    loading,
    error,
    refresh,
  };
}
