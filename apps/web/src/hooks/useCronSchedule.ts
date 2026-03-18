import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getSchedule, updateSchedule as updateScheduleApi } from '@/services/cronAgentApi';
import { ApiError } from '@/services/apiClient';
import type { CronSchedule, CronScheduleStatus } from '@/types';

export function useCronSchedule(id: string | undefined): {
  schedule: CronSchedule | null;
  loading: boolean;
  error: string | null;
  notFound: boolean;
  refresh: () => Promise<void>;
  update: (updates: Partial<{ name: string; status: CronScheduleStatus; action: CronSchedule['action'] }>) => Promise<void>;
} {
  const { getAccessToken } = useAuth();
  const [schedule, setSchedule] = useState<CronSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (id === undefined) return;
    setLoading(true);
    setError(null);
    setNotFound(false);

    try {
      const token = await getAccessToken();
      const data = await getSchedule(token, id);
      if (isMountedRef.current) {
        setSchedule(data);
      }
    } catch (err) {
      if (isMountedRef.current) {
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(getErrorMessage(err));
        }
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (updates: Partial<{ name: string; status: CronScheduleStatus; action: CronSchedule['action'] }>): Promise<void> => {
      if (id === undefined || schedule === null) return;

      const token = await getAccessToken();
      const updated = await updateScheduleApi(token, id, updates);
      if (isMountedRef.current) {
        setSchedule(updated);
      }
    },
    [getAccessToken, id, schedule],
  );

  return { schedule, loading, error, notFound, refresh, update };
}
