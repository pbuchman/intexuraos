import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listFailedLinearIssues } from '@/services/linearApi';
import type { FailedLinearIssue } from '@/types';

interface UseFailedLinearIssuesResult {
  issues: FailedLinearIssue[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFailedLinearIssues(): UseFailedLinearIssuesResult {
  const { getAccessToken } = useAuth();
  const [issues, setIssues] = useState<FailedLinearIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listFailedLinearIssues(token);
      setIssues(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load failed issues'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    issues,
    loading,
    error,
    refresh,
  };
}
