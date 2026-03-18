import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listSchedules as listSchedulesApi,
  createSchedule as createScheduleApi,
  updateSchedule as updateScheduleApi,
  deleteSchedule as deleteScheduleApi,
  triggerSchedule as triggerScheduleApi,
} from '@/services/cronAgentApi';
import type { CronSchedule, CronScheduleStatus, CreateScheduleRequest } from '@/types';

/**
 * Merge incoming schedules with previous state, preserving object references
 * for schedules that haven't changed (same status + updatedAt).
 */
function mergeSchedules(prev: CronSchedule[], incoming: CronSchedule[]): CronSchedule[] {
  if (prev.length === 0) return incoming;
  const prevMap = new Map(prev.map((s) => [s.id, s]));
  let changed = prev.length !== incoming.length;
  const merged = incoming.map((s) => {
    const existing = prevMap.get(s.id);
    if (existing?.status === s.status && existing.updatedAt === s.updatedAt) {
      return existing;
    }
    changed = true;
    return s;
  });
  return changed ? merged : prev;
}

export function useCronSchedules(options?: { status?: CronScheduleStatus[] }): {
  schedules: CronSchedule[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
  createSchedule: (request: CreateScheduleRequest) => Promise<string>;
  updateSchedule: (id: string, updates: Partial<CreateScheduleRequest & { status: CronScheduleStatus }>) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  triggerSchedule: (id: string) => Promise<void>;
} {
  const { getAccessToken } = useAuth();
  const [schedules, setSchedules] = useState<CronSchedule[]>([]);
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
        const listOptions: { status?: CronScheduleStatus[]; limit: number } = { limit: 50 };
        if (options?.status !== undefined && options.status.length > 0) {
          listOptions.status = options.status;
        }
        const data = await listSchedulesApi(token, listOptions);
        if (isMountedRef.current) {
          setSchedules((prev) => mergeSchedules(prev, data.schedules));
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
    [getAccessToken, options?.status]
  );

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === undefined || loadingMore) return;
    setLoadingMore(true);

    try {
      const token = await getAccessToken();
      const listOptions: { status?: CronScheduleStatus[]; limit: number; cursor: string } = {
        limit: 50,
        cursor,
      };
      if (options?.status !== undefined && options.status.length > 0) {
        listOptions.status = options.status;
      }
      const data = await listSchedulesApi(token, listOptions);
      if (isMountedRef.current) {
        setSchedules((prev) => [...prev, ...data.schedules]);
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
  }, [cursor, loadingMore, getAccessToken, options?.status]);

  const createScheduleAction = useCallback(
    async (request: CreateScheduleRequest): Promise<string> => {
      const token = await getAccessToken();
      const schedule = await createScheduleApi(token, request);
      if (isMountedRef.current) {
        setSchedules((prev) => [schedule, ...prev]);
      }
      return schedule.id;
    },
    [getAccessToken]
  );

  const updateScheduleAction = useCallback(
    async (id: string, updates: Partial<CreateScheduleRequest & { status: CronScheduleStatus }>): Promise<void> => {
      const token = await getAccessToken();
      const updated = await updateScheduleApi(token, id, updates);
      if (isMountedRef.current) {
        setSchedules((prev) => prev.map((s) => (s.id === id ? updated : s)));
      }
    },
    [getAccessToken]
  );

  const deleteScheduleAction = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteScheduleApi(token, id);
      if (isMountedRef.current) {
        setSchedules((prev) => prev.filter((s) => s.id !== id));
      }
    },
    [getAccessToken]
  );

  const triggerScheduleAction = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await triggerScheduleApi(token, id);
      // Refresh to pick up updated schedule state
      void refresh(false);
    },
    [getAccessToken, refresh]
  );

  useEffect(() => {
    isMountedRef.current = true;
    void refresh();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [refresh]);

  return {
    schedules,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    createSchedule: createScheduleAction,
    updateSchedule: updateScheduleAction,
    deleteSchedule: deleteScheduleAction,
    triggerSchedule: triggerScheduleAction,
  };
}
