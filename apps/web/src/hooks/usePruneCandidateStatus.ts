import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listPruneCandidates } from '@/services/linearApi';

export interface PruneCandidateStatus {
  /** Number of candidates pending review */
  pendingCount: number;
  /** Whether initial load is in progress */
  loading: boolean;
  /** Error message if fetch failed */
  error: string | null;
}

const POLL_INTERVAL_MS = 120_000; // 2 minutes

/**
 * Hook that polls Linear prune candidate count for the header indicator.
 * Returns the number of pending prune candidates (0 = green, >0 = red).
 */
export function usePruneCandidateStatus(): PruneCandidateStatus {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    try {
      const token = await getAccessToken();
      const candidates = await listPruneCandidates(token);
      if (isMountedRef.current) {
        setPendingCount(candidates.length);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to check prune status'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, isAuthenticated]);

  useEffect(() => {
    isMountedRef.current = true;
    void refresh();

    const interval = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return (): void => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [refresh]);

  return { pendingCount, loading, error };
}
