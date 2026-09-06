import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { ApiError } from '@/services/apiClient.js';
import { deleteLlmKey, getLlmKeys, setLlmKey, testLlmKey, updateIntexAgentModel, updateLlmPreferences } from '@/services/llmKeysApi';
import type { ConfigurableLlmProvider, LlmKeysResponse, LlmTestResult } from '@/services/llmKeysApi.types';
import { useIntexAgentModel, type UseIntexAgentModelResult } from './useIntexAgentModel.js';

interface UseLlmKeysResult {
  keys: LlmKeysResponse | null;
  defaultModel: string | null;
  fallbackModel: string | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  savingDefaultModel: boolean;
  intexAgentModel: UseIntexAgentModelResult;
  setKey: (provider: ConfigurableLlmProvider, apiKey: string) => Promise<void>;
  deleteKey: (provider: ConfigurableLlmProvider) => Promise<void>;
  testKey: (provider: ConfigurableLlmProvider) => Promise<LlmTestResult>;
  setDefaultModel: (model: string) => Promise<void>;
  setFallbackModel: (model: string | null) => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
}

export function useLlmKeys(): UseLlmKeysResult {
  const { user, getAccessToken } = useAuth();
  const [keys, setKeys] = useState<LlmKeysResponse | null>(null);
  const [keysSubject, setKeysSubject] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingDefaultModel, setSavingDefaultModel] = useState(false);
  const mountedRef = useRef(true);
  const subjectRef = useRef(user?.sub);
  const subjectEpochRef = useRef(0);
  const refreshGenerationRef = useRef(0);
  const ownedKeys = user?.sub !== undefined && keysSubject === user.sub ? keys : null;

  if (subjectRef.current !== user?.sub) {
    subjectRef.current = user?.sub;
    subjectEpochRef.current += 1;
    refreshGenerationRef.current += 1;
  }

  useEffect((): (() => void) => {
    mountedRef.current = true;
    return (): void => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setKeys(null);
    setKeysSubject(undefined);
    setSavingDefaultModel(false);
    setError(null);
    if (user?.sub === undefined) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.sub]);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const userId = user?.sub;
      const generation = refreshGenerationRef.current + 1;
      refreshGenerationRef.current = generation;
      const current = (): boolean =>
        mountedRef.current && subjectRef.current === userId && refreshGenerationRef.current === generation;
      if (userId === undefined) {
        if (current()) setLoading(false);
        return;
      }

      const shouldShowLoading = showLoading !== false;

      if (shouldShowLoading) {
        if (current()) setLoading(true);
      } else {
        if (current()) setRefreshing(true);
      }
      if (current()) setError(null);

      try {
        const token = await getAccessToken();
        if (!current()) return;
        const data = await getLlmKeys(token, userId);
        if (current()) {
          setKeys(data);
          setKeysSubject(userId);
        }
      } catch (err) {
        if (current()) {
          if (err instanceof ApiError && err.status === 404) {
            setKeys(null);
            setKeysSubject(undefined);
          }
          setError(getErrorMessage(err, 'Failed to load API keys'));
        }
      } finally {
        if (current()) {
          if (shouldShowLoading) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [user?.sub, getAccessToken]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setKey = useCallback(
    async (provider: ConfigurableLlmProvider, apiKey: string): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;
      const subjectEpoch = subjectEpochRef.current;
      const current = (): boolean =>
        mountedRef.current && subjectRef.current === userId && subjectEpochRef.current === subjectEpoch;

      try {
        const token = await getAccessToken();
        if (!current()) return;
        await setLlmKey(token, userId, { provider, apiKey });
        if (!current()) return;
        await refresh(false);
      } catch (err) {
        if (current()) setError(getErrorMessage(err, 'Failed to save API key'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const deleteKey = useCallback(
    async (provider: ConfigurableLlmProvider): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;
      const subjectEpoch = subjectEpochRef.current;
      const current = (): boolean =>
        mountedRef.current && subjectRef.current === userId && subjectEpochRef.current === subjectEpoch;

      try {
        const token = await getAccessToken();
        if (!current()) return;
        await deleteLlmKey(token, userId, provider);
        if (!current()) return;
        await refresh(false);
      } catch (err) {
        if (current()) setError(getErrorMessage(err, 'Failed to delete API key'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const testKey = useCallback(
    async (provider: ConfigurableLlmProvider): Promise<LlmTestResult> => {
      const userId = user?.sub;
      if (userId === undefined) {
        throw new Error('User not authenticated');
      }
      const subjectEpoch = subjectEpochRef.current;
      const current = (): boolean =>
        mountedRef.current && subjectRef.current === userId && subjectEpochRef.current === subjectEpoch;

      const token = await getAccessToken();
      const result = await testLlmKey(token, userId, provider);

      if (current()) {
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
      }

      return result;
    },
    [user?.sub, getAccessToken]
  );

  const setDefaultModel = useCallback(
    async (model: string): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;
      const subjectEpoch = subjectEpochRef.current;
      const current = (): boolean =>
        mountedRef.current && subjectRef.current === userId && subjectEpochRef.current === subjectEpoch;

      const previousModel = ownedKeys?.defaultModel ?? null;
      const previousStoredFallback = ownedKeys?.fallbackModel ?? null;
      const previousFallback =
        previousStoredFallback === previousModel ? null : previousStoredFallback;
      const nextFallback = previousFallback === model ? null : previousFallback;

      setSavingDefaultModel(true);
      setError(null);

      // Optimistic update
      setKeys((prev) => {
        if (prev === null) return prev;
        return { ...prev, defaultModel: model, fallbackModel: nextFallback };
      });

      try {
        const token = await getAccessToken();
        if (!current()) return;
        await updateLlmPreferences(token, userId, model, nextFallback);
      } catch (err) {
        if (!current()) return;
        // Revert on failure
        setKeys((prev) => {
          if (prev === null) return prev;
          return {
            ...prev,
            defaultModel: previousModel,
            fallbackModel: previousStoredFallback,
          };
        });
        setError(getErrorMessage(err, 'Failed to save default model'));
      } finally {
        if (current()) setSavingDefaultModel(false);
      }
    },
    [user?.sub, getAccessToken, ownedKeys?.defaultModel, ownedKeys?.fallbackModel]
  );

  const setFallbackModel = useCallback(
    async (model: string | null): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;
      const subjectEpoch = subjectEpochRef.current;
      const current = (): boolean =>
        mountedRef.current && subjectRef.current === userId && subjectEpochRef.current === subjectEpoch;

      const currentDefault = ownedKeys?.defaultModel;
      if (currentDefault === null || currentDefault === undefined) return;

      const previousFallback = ownedKeys?.fallbackModel ?? null;
      const nextFallback = model === currentDefault ? null : model;

      setSavingDefaultModel(true);
      setError(null);

      // Optimistic update
      setKeys((prev) => {
        if (prev === null) return prev;
        return { ...prev, fallbackModel: nextFallback };
      });

      try {
        const token = await getAccessToken();
        if (!current()) return;
        await updateLlmPreferences(token, userId, currentDefault, nextFallback);
      } catch (err) {
        if (!current()) return;
        // Revert on failure
        setKeys((prev) => {
          if (prev === null) return prev;
          return { ...prev, fallbackModel: previousFallback };
        });
        setError(getErrorMessage(err, 'Failed to save fallback model'));
      } finally {
        if (current()) setSavingDefaultModel(false);
      }
    },
    [user?.sub, getAccessToken, ownedKeys?.defaultModel, ownedKeys?.fallbackModel]
  );

  const defaultModel = ownedKeys?.defaultModel ?? null;
  const storedFallbackModel = ownedKeys?.fallbackModel ?? null;
  const fallbackModel = storedFallbackModel === defaultModel ? null : storedFallbackModel;
  const intexAgentModel = useIntexAgentModel({
    subject: user?.sub,
    selector: ownedKeys?.intexAgentModelSelector,
    getAccessToken,
    getLlmKeys,
    updateIntexAgentModel,
  });

  return { keys: ownedKeys, defaultModel, fallbackModel, loading, refreshing, error, savingDefaultModel, intexAgentModel, setKey, deleteKey, testKey, setDefaultModel, setFallbackModel, refresh };
}
