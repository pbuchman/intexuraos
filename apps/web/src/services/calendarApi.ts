import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  CalendarDailyNotificationSettings,
  CalendarEvent,
  FailedCalendarEvent,
} from '@/types';

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
    `/events${query}`,
    accessToken
  );
  return response.events;
}

interface ListFailedEventsResponse {
  failedEvents: FailedCalendarEvent[];
}

export async function listFailedEvents(
  accessToken: string
): Promise<FailedCalendarEvent[]> {
  const response = await apiRequest<ListFailedEventsResponse>(
    config.calendarAgentUrl,
    '/failed-events',
    accessToken
  );
  return response.failedEvents;
}

export async function deleteFailedEvent(
  accessToken: string,
  id: string
): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.calendarAgentUrl,
    `/failed-events/${id}`,
    accessToken,
    { method: 'DELETE' }
  );
}

interface RetryFailedEventResponse {
  event: CalendarEvent;
}

export async function retryFailedEvent(
  accessToken: string,
  id: string
): Promise<RetryFailedEventResponse> {
  return await apiRequest<RetryFailedEventResponse>(
    config.calendarAgentUrl,
    `/failed-events/${id}/retry`,
    accessToken,
    { method: 'POST' }
  );
}

export interface UpdateCalendarDailyNotificationRequest {
  enabled: boolean;
  localTime: string;
  timeZone: string;
}

export async function getCalendarDailyNotificationSettings(
  accessToken: string
): Promise<CalendarDailyNotificationSettings> {
  return await apiRequest<CalendarDailyNotificationSettings>(
    config.calendarAgentUrl,
    '/schedules/calendar-daily-lookahead',
    accessToken
  );
}

export async function updateCalendarDailyNotificationSettings(
  accessToken: string,
  request: UpdateCalendarDailyNotificationRequest
): Promise<CalendarDailyNotificationSettings> {
  return await apiRequest<CalendarDailyNotificationSettings>(
    config.calendarAgentUrl,
    '/schedules/calendar-daily-lookahead',
    accessToken,
    { method: 'PUT', body: request }
  );
}
