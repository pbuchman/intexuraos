import type {
  CalendarCreateEventRequest,
  CalendarCreatedEvent,
  CalendarGeneratePreviewRequest,
  CalendarListEvent,
  CalendarListEventsRequest,
  CalendarProcessActionRequest,
  CalendarUpdateEventRequest,
  CalendarUpdateEventAttendeesRequest,
} from '@intexuraos/http-contracts';
import type { Result, ServiceFeedback } from '@intexuraos/common-core';
import type { InternalHttpClientLogger } from '../shared/createInternalHttpClient.js';
import type { ServiceFeedbackRequestOptions } from '../shared/serviceFeedback.js';

export interface CalendarAgentServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger: InternalHttpClientLogger;
  defaultTimeoutMs?: number;
}

export type ProcessCalendarRequest = CalendarProcessActionRequest;
export type CreateCalendarEventRequest = CalendarCreateEventRequest;
export type CreatedCalendarEvent = CalendarCreatedEvent;
export type CalendarEvent = CalendarListEvent;
export interface CalendarEventsPage {
  events: CalendarEvent[];
  truncated: boolean;
}
export type ListCalendarEventsRequest = CalendarListEventsRequest;
export type UpdateCalendarEventAttendeesRequest = CalendarUpdateEventAttendeesRequest & {
  eventId: string;
};
export type UpdateCalendarEventRequest = CalendarUpdateEventRequest & { eventId: string };
export type GeneratePreviewRequest = CalendarGeneratePreviewRequest;

export type CalendarPreviewStatus = 'pending' | 'ready' | 'failed';

export interface CalendarPreview {
  actionId: string;
  userId: string;
  status: CalendarPreviewStatus;
  summary?: string;
  start?: string;
  end?: string | null;
  location?: string | null;
  description?: string | null;
  duration?: string | null;
  isAllDay?: boolean;
  error?: string;
  reasoning?: string;
  generatedAt: string;
}

export type CalendarAgentRequestOptions = ServiceFeedbackRequestOptions;

export interface CalendarAgentServiceClient {
  createEvent(
    request: CreateCalendarEventRequest,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<CreatedCalendarEvent>>;

  listEvents(
    request: ListCalendarEventsRequest,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<CalendarEventsPage>>;

  updateEventAttendees(
    request: UpdateCalendarEventAttendeesRequest,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<CreatedCalendarEvent>>;

  updateEvent(
    request: UpdateCalendarEventRequest,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<CreatedCalendarEvent>>;

  processAction(
    request: ProcessCalendarRequest,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<ServiceFeedback>>;

  getPreview(
    actionId: string,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<CalendarPreview | null>>;

  generatePreview(
    request: GeneratePreviewRequest,
    options?: CalendarAgentRequestOptions
  ): Promise<Result<CalendarPreview | null>>;
}
