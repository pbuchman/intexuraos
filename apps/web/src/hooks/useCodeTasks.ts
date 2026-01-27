import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listCodeTasks as listCodeTasksApi,
  getCodeTask as getCodeTaskApi,
  submitCodeTask as submitCodeTaskApi,
  cancelCodeTask as cancelCodeTaskApi,
  getWorkersStatus as getWorkersStatusApi,
} from '@/services/codeAgentApi';
import type { CodeTask, CodeTaskStatus, SubmitCodeTaskRequest, WorkersStatusResponse } from '@/types';
import {
  getFirestoreClient,
  authenticateFirebase,
  isFirebaseAuthenticated,
  initializeFirebase,
} from '@/services/firebase';

/**
 * Hook for fetching a single code task by ID with real-time Firestore updates.
 */
export function useCodeTask(id: string): {
  task: CodeTask | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
  cancelTask: () => Promise<void>;
} {
  const { getAccessToken, isAuthenticated, user } = useAuth();
  const [task, setTask] = useState<CodeTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unsubscribeRef = useRef<Unsubscribe | null>(null);
  const firebaseAuthenticatedRef = useRef(false);
  const lastStatusRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const shouldShowLoading = showLoading !== false;

      if (id === '') {
        if (isMountedRef.current) {
          setLoading(false);
        }
        return;
      }

      if (shouldShowLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await getCodeTaskApi(token, id);
        if (isMountedRef.current) {
          setTask(data);
          lastStatusRef.current = data.status;
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load code task'));
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
    [id, getAccessToken]
  );

  useEffect(() => {
    isMountedRef.current = true;
    void refresh();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!isAuthenticated || user === undefined || id === '' || task === null) {
      return;
    }

    const inProgressStatuses: CodeTaskStatus[] = ['dispatched', 'running'];
    if (!inProgressStatuses.includes(task.status)) {
      if (unsubscribeRef.current !== null) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      return;
    }

    let listenerFailed = false;

    const setupListener = async (): Promise<void> => {
      try {
        if (!firebaseAuthenticatedRef.current || !isFirebaseAuthenticated()) {
          initializeFirebase();
          const token = await getAccessToken();
          await authenticateFirebase(token);
          firebaseAuthenticatedRef.current = true;
        }

        const db = getFirestoreClient();
        const taskRef = doc(db, 'code_tasks', id);

        unsubscribeRef.current = onSnapshot(
          taskRef,
          (snapshot) => {
            if (snapshot.exists()) {
              const data = snapshot.data();
              const newStatus = data['status'] as string | undefined;

              if (newStatus !== undefined && newStatus !== lastStatusRef.current) {
                lastStatusRef.current = newStatus;
                void refresh(false);
              }
            }
          },
          () => {
            listenerFailed = true;
          }
        );
      } catch {
        listenerFailed = true;
      }
    };

    void setupListener();

    const pollInterval = setInterval(() => {
      if (listenerFailed) {
        void refresh(false);
      }
    }, 5000);

    return (): void => {
      clearInterval(pollInterval);
      if (unsubscribeRef.current !== null) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [isAuthenticated, user, id, task?.status, getAccessToken, refresh]);

  const cancelTask = useCallback(async (): Promise<void> => {
    if (task === null) return;
    const token = await getAccessToken();
    await cancelCodeTaskApi(token, task.id);
    await refresh(false);
  }, [task, getAccessToken, refresh]);

  return { task, loading, refreshing, error, refresh, cancelTask };
}

/**
 * Hook for managing a list of code tasks with pagination.
 */
export function useCodeTasks(options?: { status?: CodeTaskStatus }): {
  tasks: CodeTask[];
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  submitTask: (request: SubmitCodeTaskRequest) => Promise<string>;
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
        const listOptions = options?.status !== undefined ? { status: options.status } : {};
        const data = await listCodeTasksApi(token, listOptions);
        if (isMountedRef.current) {
          setTasks(data.tasks);
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

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading || loadingMore) return;

    setLoadingMore(true);
    try {
      const token = await getAccessToken();
      const loadMoreOptions: { status?: CodeTaskStatus; cursor?: string } = {};
      if (options?.status !== undefined) {
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
  };
}

/**
 * Hook for fetching worker status (Mac and VM health).
 * Polls every 30 seconds when visible.
 */
export function useWorkersStatus(): {
  status: WorkersStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<WorkersStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
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
    }, 30000);

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

  return { status, loading, error, refresh };
}
