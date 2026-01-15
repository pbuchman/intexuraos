import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listFailedEvents } from '@/services/calendarApi';
import type { FailedCalendarEvent } from '@/types';

interface UseFailedCalendarEventsResult {
  events: FailedCalendarEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useFailedCalendarEvents(): UseFailedCalendarEventsResult {
  const { getAccessToken } = useAuth();
  const [events, setEvents] = useState<FailedCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listFailedEvents(token);
      setEvents(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load failed events'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    events,
    loading,
    error,
    refresh,
  };
}
