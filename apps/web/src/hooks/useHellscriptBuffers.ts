import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listHellscriptBuffers as listBuffersApi } from '@/services/hellscriptAgentApi';
import type { HellscriptBufferSummary } from '@/types';

interface UseHellscriptBuffersResult {
  buffers: HellscriptBufferSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useHellscriptBuffers(): UseHellscriptBuffersResult {
  const { getAccessToken } = useAuth();
  const [buffers, setBuffers] = useState<HellscriptBufferSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listBuffersApi(token);
      setBuffers(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load hellscript buffers'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    buffers,
    loading,
    error,
    refresh,
  };
}
