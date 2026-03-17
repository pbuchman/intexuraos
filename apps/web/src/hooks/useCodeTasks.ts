import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listCodeTasks as listCodeTasksApi,
  submitCodeTask as submitCodeTaskApi,
  deleteCodeTask as deleteCodeTaskApi,
  getWorkersStatus as getWorkersStatusApi,
  refreshWorkersStatus as refreshWorkersStatusApi,
} from '@/services/codeAgentApi';
import { ACTIVE_STATUSES } from '@/utils/issueGroups';
import type { CodeTask, CodeTaskStatus, SubmitCodeTaskRequest, WorkersStatusResponse } from '@/types';

/**
 * Merge incoming tasks with previous state, preserving object references
 * for tasks that haven't changed (same status + updatedAt). This prevents
 * unnecessary re-renders in downstream memoized components.
 */
function mergeTasks(prev: CodeTask[], incoming: CodeTask[]): CodeTask[] {
  if (prev.length === 0) return incoming;
  const prevMap = new Map(prev.map((t) => [t.id, t]));
  let changed = prev.length !== incoming.length;
  const merged = incoming.map((t) => {
    const existing = prevMap.get(t.id);
    if (existing?.status === t.status && existing.updatedAt === t.updatedAt) {
      return existing;
    }
    changed = true;
    return t;
  });
  return changed ? merged : prev;
}

/**
 * Hook for managing a list of code tasks with pagination.
 */
export function useCodeTasks(options?: { status?: CodeTaskStatus[] }): {
  tasks: CodeTask[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
  submitTask: (request: SubmitCodeTaskRequest) => Promise<string>;
  deleteTask: (id: string) => Promise<void>;
} {
  const { getAccessToken } = useAuth();
  const [tasks, setTasks] = useState<CodeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const isInitialLoadRef = useRef(true);
  const isMountedRef = useRef(true);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const shouldShowLoading = showLoading !== false;

      if (shouldShowLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const listOptions: { status?: CodeTaskStatus[]; limit: number } = { limit: 50 };
        if (options?.status !== undefined && options.status.length > 0) {
          listOptions.status = options.status;
        }
        const data = await listCodeTasksApi(token, listOptions);
        if (isMountedRef.current) {
          setTasks((prev) => mergeTasks(prev, data.tasks));
          setCursor(data.nextCursor);
          setHasMore(data.nextCursor !== undefined);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load code tasks'));
        }
      } finally {
        if (isMountedRef.current) {
          if (shouldShowLoading) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [getAccessToken, options?.status]
  );

  useEffect(() => {
    isMountedRef.current = true;
    void refresh();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && !isInitialLoadRef.current) {
        void refresh(false);
      }
      isInitialLoadRef.current = false;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    const hasActiveTasks = tasks.some((t) => ACTIVE_STATUSES.has(t.status));
    if (!hasActiveTasks) return;

    const pollId = setInterval(() => { void refresh(false); }, 30000);
    return (): void => { clearInterval(pollId); };
  }, [tasks, refresh]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading || loadingMore) return;

    setLoadingMore(true);
    try {
      const token = await getAccessToken();
      const loadMoreOptions: { status?: CodeTaskStatus[]; cursor?: string; limit: number } = { limit: 50 };
      if (options?.status !== undefined && options.status.length > 0) {
        loadMoreOptions.status = options.status;
      }
      if (cursor !== undefined) {
        loadMoreOptions.cursor = cursor;
      }
      const data = await listCodeTasksApi(token, loadMoreOptions);
      setTasks((prev) => [...prev, ...data.tasks]);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== undefined);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load more'));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, hasMore, loading, loadingMore, getAccessToken, options?.status]);

  const submitTask = useCallback(
    async (request: SubmitCodeTaskRequest): Promise<string> => {
      const token = await getAccessToken();
      const result = await submitCodeTaskApi(token, request);
      await refresh();
      return result.codeTaskId;
    },
    [getAccessToken, refresh]
  );

  const deleteTask = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteCodeTaskApi(token, id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    },
    [getAccessToken]
  );

  return {
    tasks,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    loadMore,
    refresh,
    submitTask,
    deleteTask,
  };
}

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
