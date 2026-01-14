import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { CalendarEvent, FailedCalendarEvent } from '@/types';

export interface ListCalendarEventsFilters {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  q?: string;
}

function buildQueryString(filters: ListCalendarEventsFilters): string {
  const params = new URLSearchParams();
  if (filters.timeMin !== undefined) {
    params.set('timeMin', filters.timeMin);
  }
  if (filters.timeMax !== undefined) {
    params.set('timeMax', filters.timeMax);
  }
  if (filters.maxResults !== undefined) {
    params.set('maxResults', String(filters.maxResults));
  }
  if (filters.q !== undefined) {
    params.set('q', filters.q);
  }
  const query = params.toString();
  return query !== '' ? `?${query}` : '';
}

interface ListEventsResponse {
  events: CalendarEvent[];
}

export async function listCalendarEvents(
  accessToken: string,
  filters: ListCalendarEventsFilters = {}
): Promise<CalendarEvent[]> {
  const query = buildQueryString(filters);
  const response = await apiRequest<ListEventsResponse>(
    config.calendarAgentUrl,
    `/calendar/events${query}`,
    accessToken
  );
  return response.events;
}

interface ListFailedEventsResponse {
  events: FailedCalendarEvent[];
}

export async function listFailedEvents(
  accessToken: string
): Promise<FailedCalendarEvent[]> {
  const response = await apiRequest<ListFailedEventsResponse>(
    config.calendarAgentUrl,
    '/calendar/failed-events',
    accessToken
  );
  return response.events;
}
