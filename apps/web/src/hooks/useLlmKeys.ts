import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { deleteLlmKey, getLlmKeys, setLlmKey, testLlmKey } from '@/services/llmKeysApi';
import type { LlmKeysResponse, LlmProvider } from '@/services/llmKeysApi.types';

interface UseLlmKeysResult {
  keys: LlmKeysResponse | null;
  loading: boolean;
  error: string | null;
  setKey: (provider: LlmProvider, apiKey: string) => Promise<void>;
  deleteKey: (provider: LlmProvider) => Promise<void>;
  testKey: (provider: LlmProvider) => Promise<{ response: string; testedAt: string }>;
  refresh: () => Promise<void>;
}

export function useLlmKeys(): UseLlmKeysResult {
  const { user, getAccessToken } = useAuth();
  const [keys, setKeys] = useState<LlmKeysResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const userId = user?.sub;
    if (userId === undefined) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await getLlmKeys(token, userId);
      setKeys(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load API keys'));
    } finally {
      setLoading(false);
    }
  }, [user?.sub, getAccessToken]);

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
    async (provider: LlmProvider): Promise<{ response: string; testedAt: string }> => {
      const userId = user?.sub;
      if (userId === undefined) {
        throw new Error('User not authenticated');
      }

      // Don't set global error for test operations - let component handle it locally
      const token = await getAccessToken();
      const result = await testLlmKey(token, userId, provider);
      // Refresh keys to get updated test results
      void refresh();
      return result;
    },
    [user?.sub, getAccessToken, refresh]
  );

  return { keys, loading, error, setKey, deleteKey, testKey, refresh };
}
