import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listExecutions as listExecutionsApi } from '@/services/cronAgentApi';
import type { CronExecution, CronExecutionStatus } from '@/types';

/**
 * Merge incoming executions with previous state, preserving object references
 * for executions that haven't changed (same status + completedAt).
 */
function mergeExecutions(prev: CronExecution[], incoming: CronExecution[]): CronExecution[] {
  if (prev.length === 0) return incoming;
  const prevMap = new Map(prev.map((e) => [e.id, e]));
  let changed = prev.length !== incoming.length;
  const merged = incoming.map((e) => {
    const existing = prevMap.get(e.id);
    if (existing?.status === e.status && existing.completedAt === e.completedAt) {
      return existing;
    }
    changed = true;
    return e;
  });
  return changed ? merged : prev;
}

export function useCronExecutions(options?: {
  scheduleId?: string;
  status?: CronExecutionStatus[];
}): {
  executions: CronExecution[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
} {
  const { getAccessToken } = useAuth();
  const [executions, setExecutions] = useState<CronExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const isMountedRef = useRef(true);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const shouldShowLoading = showLoading !== false;
      if (shouldShowLoading) {
        setLoading(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const listOptions: {
          scheduleId?: string;
          status?: CronExecutionStatus[];
          limit: number;
        } = { limit: 50 };
        if (options?.scheduleId !== undefined) {
          listOptions.scheduleId = options.scheduleId;
        }
        if (options?.status !== undefined && options.status.length > 0) {
          listOptions.status = options.status;
        }
        const data = await listExecutionsApi(token, listOptions);
        if (isMountedRef.current) {
          setExecutions((prev) => mergeExecutions(prev, data.executions));
          setCursor(data.nextCursor);
          setHasMore(data.nextCursor !== undefined);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err));
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [getAccessToken, options?.scheduleId, options?.status]
  );

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === undefined || loadingMore) return;
    setLoadingMore(true);

    try {
      const token = await getAccessToken();
      const listOptions: {
        scheduleId?: string;
        status?: CronExecutionStatus[];
        limit: number;
        cursor: string;
      } = { limit: 50, cursor };
      if (options?.scheduleId !== undefined) {
        listOptions.scheduleId = options.scheduleId;
      }
      if (options?.status !== undefined && options.status.length > 0) {
        listOptions.status = options.status;
      }
      const data = await listExecutionsApi(token, listOptions);
      if (isMountedRef.current) {
        setExecutions((prev) => [...prev, ...data.executions]);
        setCursor(data.nextCursor);
        setHasMore(data.nextCursor !== undefined);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [cursor, loadingMore, getAccessToken, options?.scheduleId, options?.status]);

  useEffect(() => {
    isMountedRef.current = true;
    void refresh();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [refresh]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      void refresh(false);
    }, 30000);
    return (): void => {
      clearInterval(interval);
    };
  }, [refresh]);

  return {
    executions,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}
