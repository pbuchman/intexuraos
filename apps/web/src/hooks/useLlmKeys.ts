import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { deleteLlmKey, getLlmKeys, setLlmKey, testLlmKey } from '@/services/llmKeysApi';
import type { LlmKeysResponse, LlmProvider, LlmTestResult } from '@/services/llmKeysApi.types';

interface UseLlmKeysResult {
  keys: LlmKeysResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  setKey: (provider: LlmProvider, apiKey: string) => Promise<void>;
  deleteKey: (provider: LlmProvider) => Promise<void>;
  testKey: (provider: LlmProvider) => Promise<LlmTestResult>;
  refresh: (showLoading?: boolean) => Promise<void>;
}

export function useLlmKeys(): UseLlmKeysResult {
  const { user, getAccessToken } = useAuth();
  const [keys, setKeys] = useState<LlmKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) {
        setLoading(false);
        return;
      }

      const shouldShowLoading = showLoading !== false;

      if (shouldShowLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await getLlmKeys(token, userId);
        setKeys(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load API keys'));
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [user?.sub, getAccessToken]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setKey = useCallback(
    async (provider: LlmProvider, apiKey: string): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await setLlmKey(token, userId, { provider, apiKey });
        await refresh();
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to save API key'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const deleteKey = useCallback(
    async (provider: LlmProvider): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await deleteLlmKey(token, userId, provider);
        await refresh();
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to delete API key'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const testKey = useCallback(
    async (provider: LlmProvider): Promise<LlmTestResult> => {
      const userId = user?.sub;
      if (userId === undefined) {
        throw new Error('User not authenticated');
      }

      const token = await getAccessToken();
      const result = await testLlmKey(token, userId, provider);

      setKeys((prev) => {
        if (prev === null) return prev;
        return {
          ...prev,
          testResults: {
            ...prev.testResults,
            [provider]: result,
          },
        };
      });

      return result;
    },
    [user?.sub, getAccessToken]
  );

  return { keys, loading, refreshing, error, setKey, deleteKey, testKey, refresh };
}
