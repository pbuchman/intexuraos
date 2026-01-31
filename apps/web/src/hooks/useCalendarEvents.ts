import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listCalendarEvents as listCalendarEventsApi,
  type ListCalendarEventsFilters,
} from '@/services/calendarApi';
import type { CalendarEvent } from '@/types';
import { getCurrentMonthRange } from '@/utils';

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
  const range = getCurrentMonthRange();
  return {
    timeMin: range.start.toISOString(),
    timeMax: range.end.toISOString(),
    maxResults: 100,
  };
}

export function useCalendarEvents(
  initialFilters?: Partial<ListCalendarEventsFilters>
): UseCalendarEventsResult {
  const { getAccessToken } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListCalendarEventsFilters>(() => ({
    ...getDefaultFilters(),
    ...initialFilters,
  }));

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
