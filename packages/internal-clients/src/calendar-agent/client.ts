import type {
  CalendarCreatedEvent as ContractCalendarCreatedEvent,
  CalendarListEvent as ContractCalendarListEvent,
  CalendarPreview as ContractCalendarPreview,
} from '@intexuraos/http-contracts';
import { err, ok, type Result, type ServiceFeedback } from '@intexuraos/common-core';
import {
  createInternalHttpClient,
  type InternalHttpClient,
  type InternalHttpClientError,
} from '../shared/createInternalHttpClient.js';
import { postServiceFeedback } from '../shared/serviceFeedback.js';
import type {
  CalendarAgentRequestOptions,
  CalendarAgentServiceClient,
  CalendarAgentServiceConfig,
  CalendarEvent,
  CalendarEventsPage,
  CalendarPreview,
  CreateCalendarEventRequest,
  CreatedCalendarEvent,
  GeneratePreviewRequest,
  ListCalendarEventsRequest,
  ProcessCalendarRequest,
  UpdateCalendarEventAttendeesRequest,
} from './types.js';

const CREATE_EVENT_TIMEOUT_MS = 60_000;
const LIST_EVENTS_TIMEOUT_MS = 30_000;
const UPDATE_EVENT_ATTENDEES_TIMEOUT_MS = 30_000;
const PROCESS_ACTION_TIMEOUT_MS = 60_000;
const GENERATE_PREVIEW_TIMEOUT_MS = 30_000;

interface CalendarErrorEnvelope {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
}

function resolveTimeoutMs(
  fallbackMs: number,
  config: CalendarAgentServiceConfig,
  options: CalendarAgentRequestOptions | undefined
): number;
function resolveTimeoutMs(
  fallbackMs: number | undefined,
  config: CalendarAgentServiceConfig,
  options: CalendarAgentRequestOptions | undefined
): number | undefined;
function resolveTimeoutMs(
  fallbackMs: number | undefined,
  config: CalendarAgentServiceConfig,
  options: CalendarAgentRequestOptions | undefined
): number | undefined {
  return options?.timeoutMs ?? fallbackMs ?? config.defaultTimeoutMs;
}

function toCalendarPreview(preview: ContractCalendarPreview | null): CalendarPreview | null {
  if (preview === null) {
    return null;
  }

  return {
    actionId: preview.actionId,
    userId: preview.userId,
    status: preview.status,
    generatedAt: preview.generatedAt,
    ...(preview.summary !== undefined ? { summary: preview.summary } : {}),
    ...(preview.start !== undefined ? { start: preview.start } : {}),
    ...(preview.end !== undefined ? { end: preview.end } : {}),
    ...(preview.location !== undefined ? { location: preview.location } : {}),
    ...(preview.description !== undefined ? { description: preview.description } : {}),
    ...(preview.duration !== undefined ? { duration: preview.duration } : {}),
    ...(preview.isAllDay !== undefined ? { isAllDay: preview.isAllDay } : {}),
    ...(preview.error !== undefined ? { error: preview.error } : {}),
    ...(preview.reasoning !== undefined ? { reasoning: preview.reasoning } : {}),
  };
}

function toCreatedCalendarEvent(event: ContractCalendarCreatedEvent): CreatedCalendarEvent {
  return {
    id: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    ...(event.status !== undefined ? { status: event.status } : {}),
    ...(event.htmlLink !== undefined ? { htmlLink: event.htmlLink } : {}),
    ...(event.created !== undefined ? { created: event.created } : {}),
    ...(event.updated !== undefined ? { updated: event.updated } : {}),
    ...(event.organizer !== undefined ? { organizer: event.organizer } : {}),
    ...(event.attendees !== undefined ? { attendees: event.attendees } : {}),
  };
}

function toCalendarListEvent(event: ContractCalendarListEvent): CalendarEvent {
  return {
    id: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
    ...(event.etag !== undefined ? { etag: event.etag } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    ...(event.htmlLink !== undefined ? { htmlLink: event.htmlLink } : {}),
  };
}

function mapCalendarHttpError(error: InternalHttpClientError, errorPrefix: string): Error {
  if (error.code === 'API_ERROR') {
    const responseBody = error.body as CalendarErrorEnvelope;
    const message =
      (responseBody.success === true ? undefined : responseBody.error?.message) ??
      `HTTP ${String(error.status)}: ${error.statusText}`;
    return new Error(
      responseBody.success !== true && responseBody.error?.code === 'CONFLICT'
        ? `CONFLICT: ${message}`
        : message
    );
  }

  if (error.code === 'ENVELOPE_ERROR' || error.code === 'MALFORMED_ENVELOPE') {
    const responseBody = error.body as CalendarErrorEnvelope;
    return new Error(
      (responseBody.success === true ? undefined : responseBody.error?.message) ??
        'Invalid response from calendar-agent'
    );
  }

  return new Error(`${errorPrefix}: ${error.message}`);
}

async function createEvent(
  config: CalendarAgentServiceConfig,
  httpClient: InternalHttpClient,
  request: CreateCalendarEventRequest,
  options: CalendarAgentRequestOptions | undefined
): Promise<Result<CreatedCalendarEvent>> {
  const result = await httpClient.request<{ event: ContractCalendarCreatedEvent }>({
    path: '/internal/calendar/events',
    method: 'POST',
    body: request,
    timeoutMs: resolveTimeoutMs(CREATE_EVENT_TIMEOUT_MS, config, options),
    requestId: options?.requestId,
  });

  if (result.ok) {
    return ok(toCreatedCalendarEvent(result.value.event));
  }

  return err(mapCalendarHttpError(result.error, 'Failed to create calendar event'));
}

async function listEvents(
  config: CalendarAgentServiceConfig,
  httpClient: InternalHttpClient,
  request: ListCalendarEventsRequest,
  options: CalendarAgentRequestOptions | undefined
): Promise<Result<CalendarEventsPage>> {
  const result = await httpClient.request<{
    events: ContractCalendarListEvent[];
    truncated: boolean;
  }>({
    path: '/internal/calendar/events/query',
    method: 'POST',
    body: request,
    timeoutMs: resolveTimeoutMs(LIST_EVENTS_TIMEOUT_MS, config, options),
    requestId: options?.requestId,
  });

  if (result.ok) {
    if (!Array.isArray(result.value.events) || typeof result.value.truncated !== 'boolean') {
      return err(new Error('Invalid response from calendar-agent'));
    }
    return ok({
      events: result.value.events.map(toCalendarListEvent),
      truncated: result.value.truncated,
    });
  }

  return err(mapCalendarHttpError(result.error, 'Failed to list calendar events'));
}

async function updateEventAttendees(
  config: CalendarAgentServiceConfig,
  httpClient: InternalHttpClient,
  request: UpdateCalendarEventAttendeesRequest,
  options: CalendarAgentRequestOptions | undefined
): Promise<Result<CreatedCalendarEvent>> {
  const { eventId, ...body } = request;
  const result = await httpClient.request<{ event: ContractCalendarCreatedEvent }>({
    path: `/internal/calendar/events/${encodeURIComponent(eventId)}`,
    method: 'PATCH',
    body,
    timeoutMs: resolveTimeoutMs(UPDATE_EVENT_ATTENDEES_TIMEOUT_MS, config, options),
    requestId: options?.requestId,
  });

  if (result.ok) {
    return ok(toCreatedCalendarEvent(result.value.event));
  }

  return err(mapCalendarHttpError(result.error, 'Failed to update calendar event attendees'));
}

async function readPreviewResponse(
  config: CalendarAgentServiceConfig,
  httpClient: InternalHttpClient,
  path: string,
  errorPrefix: string,
  body: unknown,
  method: 'GET' | 'POST',
  options: CalendarAgentRequestOptions | undefined,
  fallbackTimeoutMs?: number
): Promise<Result<CalendarPreview | null>> {
  const result = await httpClient.request<{ preview: ContractCalendarPreview | null }>({
    path,
    method,
    ...(body !== undefined ? { body } : {}),
    timeoutMs: resolveTimeoutMs(fallbackTimeoutMs, config, options),
    requestId: options?.requestId,
  });

  if (result.ok) {
    return ok(toCalendarPreview(result.value.preview));
  }

  return err(mapCalendarHttpError(result.error, errorPrefix));
}

export function createCalendarAgentServiceClient(
  config: CalendarAgentServiceConfig
): CalendarAgentServiceClient {
  const httpClient = createInternalHttpClient({
    baseUrl: config.baseUrl,
    token: config.internalAuthToken,
    logger: config.logger,
    ...(config.defaultTimeoutMs !== undefined ? { defaultTimeoutMs: config.defaultTimeoutMs } : {}),
  });

  return {
    async createEvent(
      request: CreateCalendarEventRequest,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<CreatedCalendarEvent>> {
      return await createEvent(config, httpClient, request, options);
    },

    async listEvents(
      request: ListCalendarEventsRequest,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<CalendarEventsPage>> {
      return await listEvents(config, httpClient, request, options);
    },

    async updateEventAttendees(
      request: UpdateCalendarEventAttendeesRequest,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<CreatedCalendarEvent>> {
      return await updateEventAttendees(config, httpClient, request, options);
    },

    async processAction(
      request: ProcessCalendarRequest,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<ServiceFeedback>> {
      const timeoutMs = resolveTimeoutMs(PROCESS_ACTION_TIMEOUT_MS, config, options);
      const serviceFeedbackOptions: CalendarAgentRequestOptions = {};
      if (options?.requestId !== undefined) {
        serviceFeedbackOptions.requestId = options.requestId;
      }
      serviceFeedbackOptions.timeoutMs = timeoutMs;

      return await postServiceFeedback(config, {
        path: '/internal/calendar/process-action',
        body: {
          action: {
            id: request.action.id,
            userId: request.action.userId,
            title: request.action.title,
          },
          text: request.text,
        },
        options: serviceFeedbackOptions,
        invalidJsonMessage: 'Invalid response from calendar-agent',
        invalidEnvelopeMessage: 'Invalid response from calendar-agent',
        networkErrorPrefix: 'Failed to call calendar-agent',
        getDefaultHttpErrorMessage: (response) =>
          `HTTP ${String(response.status)}: ${response.statusText}`,
      });
    },

    async getPreview(
      actionId: string,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<CalendarPreview | null>> {
      return await readPreviewResponse(
        config,
        httpClient,
        `/internal/calendar/preview/${actionId}`,
        'Failed to fetch calendar preview',
        undefined,
        'GET',
        options
      );
    },

    async generatePreview(
      request: GeneratePreviewRequest,
      options?: CalendarAgentRequestOptions
    ): Promise<Result<CalendarPreview | null>> {
      return await readPreviewResponse(
        config,
        httpClient,
        '/internal/calendar/preview',
        'Failed to generate calendar preview',
        request,
        'POST',
        options,
        GENERATE_PREVIEW_TIMEOUT_MS
      );
    },
  };
}
