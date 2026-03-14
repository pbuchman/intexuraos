import { useCallback, useEffect, useState } from 'react';

function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}
import { useAuth } from '@/context';
import {
  getWorkerSettings,
  addWorker as addWorkerApi,
  updateWorker as updateWorkerApi,
  deleteWorker as deleteWorkerApi,
  testWorkerConnectivity,
  reorderWorkers as reorderWorkersApi,
  updateDefaultReviewWorkerType as updateDefaultReviewWorkerTypeApi,
} from '@/services/workerSettingsApi';
import type {
  WorkerSettingsResponse,
  WorkerConfigInput,
  WorkerConfigUpdateInput,
  TestWorkerConnectivityResponse,
} from '@/services/workerSettingsApi.types';

interface UseWorkerSettingsResult {
  settings: WorkerSettingsResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  addWorker: (config: WorkerConfigInput) => Promise<void>;
  updateWorker: (workerName: string, config: WorkerConfigUpdateInput) => Promise<void>;
  deleteWorker: (workerName: string) => Promise<void>;
  testConnectivity: (workerName: string) => Promise<TestWorkerConnectivityResponse>;
  reorderWorkers: (workerNames: string[]) => Promise<void>;
  updateDefaultReviewWorkerType: (workerType: string) => Promise<void>;
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

  const handleAddWorker = useCallback(
    async (config: WorkerConfigInput): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await addWorkerApi(token, config);
        await refresh(false);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to add worker'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const handleUpdateWorker = useCallback(
    async (workerName: string, config: WorkerConfigUpdateInput): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await updateWorkerApi(token, workerName, config);
        await refresh(false);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to update worker'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const handleDeleteWorker = useCallback(
    async (workerName: string): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await deleteWorkerApi(token, workerName);
        await refresh(false);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to delete worker'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const testConnectivity = useCallback(
    async (workerName: string): Promise<TestWorkerConnectivityResponse> => {
      const userId = user?.sub;
      if (userId === undefined) {
        throw new Error('User not authenticated');
      }

      const token = await getAccessToken();
      const result = await testWorkerConnectivity(token, workerName);

      // Update local state with test result
      setSettings((prev) => {
        if (prev === null) return prev;
        return {
          ...prev,
          workers: prev.workers.map((w) =>
            w.name === workerName
              ? {
                  ...w,
                  testStatus: result.testStatus,
                  testMessage: result.testMessage,
                  lastTestedAt: result.lastTestedAt,
                }
              : w
          ),
        };
      });

      return result;
    },
    [user?.sub, getAccessToken]
  );

  const handleUpdateDefaultReviewWorkerType = useCallback(
    async (workerType: string): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await updateDefaultReviewWorkerTypeApi(token, workerType);
        await refresh(false);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to update default review worker type'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  const handleReorderWorkers = useCallback(
    async (workerNames: string[]): Promise<void> => {
      const userId = user?.sub;
      if (userId === undefined) return;

      try {
        const token = await getAccessToken();
        await reorderWorkersApi(token, { workerNames });
        await refresh(false);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to reorder workers'));
        throw err;
      }
    },
    [user?.sub, getAccessToken, refresh]
  );

  return {
    settings,
    loading,
    refreshing,
    error,
    addWorker: handleAddWorker,
    updateWorker: handleUpdateWorker,
    deleteWorker: handleDeleteWorker,
    testConnectivity,
    reorderWorkers: handleReorderWorkers,
    updateDefaultReviewWorkerType: handleUpdateDefaultReviewWorkerType,
    refresh,
  };
}
