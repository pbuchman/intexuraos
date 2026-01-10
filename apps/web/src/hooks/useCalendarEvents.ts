import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  listCalendarEvents as listCalendarEventsApi,
  type ListCalendarEventsFilters,
} from '@/services/calendarApi';
import type { CalendarEvent } from '@/types';

interface UseCalendarEventsResult {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  filters: ListCalendarEventsFilters;
  setFilters: (filters: ListCalendarEventsFilters) => void;
  refresh: () => Promise<void>;
}

function getDefaultFilters(): ListCalendarEventsFilters {
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return {
    timeMin: startOfWeek.toISOString(),
    timeMax: endOfWeek.toISOString(),
    maxResults: 50,
  };
}

export function useCalendarEvents(): UseCalendarEventsResult {
  const { getAccessToken } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListCalendarEventsFilters>(getDefaultFilters);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listCalendarEventsApi(token, filters);
      setEvents(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load calendar events'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, filters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    events,
    loading,
    error,
    filters,
    setFilters,
    refresh,
  };
}
