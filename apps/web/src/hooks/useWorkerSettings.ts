import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  getWorkerSettings,
  updateWorkerConfig,
  deleteWorkerConfig,
  testWorkerConnectivity,
} from '@/services/workerSettingsApi';
import type {
  WorkerSettingsResponse,
  WorkerType,
  WorkerConfigInput,
  TestWorkerConnectivityResponse,
} from '@/services/workerSettingsApi.types';

interface UseWorkerSettingsResult {
  settings: WorkerSettingsResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  updateConfig: (workerType: WorkerType, config: WorkerConfigInput) => Promise<void>;
  deleteConfig: (workerType: WorkerType) => Promise<void>;
  testConnectivity: (workerType: WorkerType) => Promise<TestWorkerConnectivityResponse>;
  refresh: (showLoading?: boolean) => Promise<void>;
}

export function useWorkerSettings(): UseWorkerSettingsResult {
  const { user, getAccessToken } = useAuth();
  const [settings, setSettings] = useState<WorkerSettingsResponse | null>(null);
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
        const data = await getWorkerSettings(token);
        setSettings(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load worker settings'));
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

  const updateConfig = useCallback(
    async (workerType: WorkerType, config: WorkerConfigInput): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await updateWorkerConfig(token, workerType, config);
        await refresh(false);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to save worker configuration'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const deleteConfig = useCallback(
    async (workerType: WorkerType): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await deleteWorkerConfig(token, workerType);
        await refresh(false);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to delete worker configuration'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const testConnectivity = useCallback(
    async (workerType: WorkerType): Promise<TestWorkerConnectivityResponse> => {
      const userId = user?.sub;
      if (userId === undefined) {
        throw new Error('User not authenticated');
      }

      const token = await getAccessToken();
      const result = await testWorkerConnectivity(token, workerType);

      setSettings((prev) => {
        if (prev === null) return prev;
        return {
          ...prev,
          [workerType]: prev[workerType] !== undefined
            ? {
                ...prev[workerType],
                testStatus: result.testStatus,
                testMessage: result.testMessage,
                lastTestedAt: result.lastTestedAt,
              }
            : undefined,
        };
      });

      return result;
    },
    [user?.sub, getAccessToken]
  );

  return { settings, loading, refreshing, error, updateConfig, deleteConfig, testConnectivity, refresh };
}
