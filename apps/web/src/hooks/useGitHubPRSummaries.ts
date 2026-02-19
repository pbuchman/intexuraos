import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getGitHubPRSummaries } from '@/services/codeAgentApi';
import type { GitHubPRSummary } from '@/types';

/**
 * Hook for fetching the list of recently-active PRs (last 30 days).
 * Returns PRs sorted by PR number descending (backend handles sort).
 */
export function useGitHubPRSummaries(): {
  prs: GitHubPRSummary[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [prs, setPrs] = useState<GitHubPRSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchSummaries = useCallback(
    async (showLoading = true): Promise<void> => {
      if (!isAuthenticated) {
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await getGitHubPRSummaries(token);
        if (isMountedRef.current) {
          setPrs(data.prs);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load PR summaries'));
        }
      } finally {
        if (isMountedRef.current) {
          if (showLoading) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [getAccessToken, isAuthenticated]
  );

  const refresh = useCallback(async (): Promise<void> => {
    await fetchSummaries(false);
  }, [fetchSummaries]);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchSummaries();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [fetchSummaries]);

  return { prs, loading, refreshing, error, refresh };
}
