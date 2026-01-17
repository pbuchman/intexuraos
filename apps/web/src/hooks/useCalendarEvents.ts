import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listCalendarEvents as listCalendarEventsApi,
  type ListCalendarEventsFilters,
} from '@/services/calendarApi';
import type { CalendarEvent } from '@/types';
import { getCurrentWeekRange } from '@/utils';

interface UseCalendarEventsResult {
  events: CalendarEvent[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  filters: ListCalendarEventsFilters;
  setFilters: (filters: ListCalendarEventsFilters) => void;
  refresh: (showLoading?: boolean) => Promise<void>;
}

function getDefaultFilters(): ListCalendarEventsFilters {
  const { start, end } = getCurrentWeekRange();
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    maxResults: 50,
  };
}

export function useCalendarEvents(): UseCalendarEventsResult {
  const { getAccessToken } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListCalendarEventsFilters>(getDefaultFilters);

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
        const data = await listCalendarEventsApi(token, filters);
        setEvents(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load calendar events'));
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [getAccessToken, filters]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    events,
    loading,
    refreshing,
    error,
    filters,
    setFilters,
    refresh,
  };
}
