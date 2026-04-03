import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  getWorkersStatus as getWorkersStatusApi,
  refreshWorkersStatus as refreshWorkersStatusApi,
} from '@/services/codeAgentApi';
import type { CodeTask, WorkersStatusResponse } from '@/types';

/**
 * Find a recently created task matching a prompt.
 * Used for timeout recovery: checks if a task was created server-side
 * despite the client timing out.
 */
const RECENT_TASK_WINDOW_MS = 120000; // 2 minutes

export function findRecentTask(tasks: CodeTask[], prompt: string): CodeTask | null {
  const trimmedPrompt = prompt.trim();
  const now = Date.now();

  for (const task of tasks) {
    const taskAge = now - new Date(task.createdAt).getTime();
    if (taskAge <= RECENT_TASK_WINDOW_MS && task.prompt.trim() === trimmedPrompt) {
      return task;
    }
  }
  return null;
}

/**
 * Hook for fetching worker status (Mac and VM health).
 * Polls every 60 seconds when visible.
 */
export function useWorkersStatus(): {
  status: WorkersStatusResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
} {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<WorkersStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const isInitialLoadRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }

    try {
      const token = await getAccessToken();
      const data = await getWorkersStatusApi(token);
      if (isMountedRef.current) {
        setStatus(data);
        setError(null);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to check worker status'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, isAuthenticated]);

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      return;
    }

    if (isMountedRef.current) {
      setRefreshing(true);
    }

    try {
      const token = await getAccessToken();
      const data = await refreshWorkersStatusApi(token);
      if (isMountedRef.current) {
        setStatus(data);
        setError(null);
      }
    } catch {
      // Silently fail - status update is best effort
    } finally {
      if (isMountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [getAccessToken, isAuthenticated]);

  useEffect(() => {
    isMountedRef.current = true;
    void refresh();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const pollInterval = setInterval(() => {
      void refresh();
    }, 60000);

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && !isInitialLoadRef.current) {
        void refresh();
      }
      isInitialLoadRef.current = false;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return (): void => {
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh, isAuthenticated]);

  return { status, loading, refreshing, error, refresh, refreshStatus };
}
