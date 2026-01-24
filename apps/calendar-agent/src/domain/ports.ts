/**
 * Port interfaces for calendar-agent external dependencies.
 */

import type { Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  CalendarEvent,
  CreateEventInput,
  FreeBusyInput,
  FreeBusySlot,
  ListEventsInput,
  UpdateEventInput,
  FailedEvent,
  CreateFailedEventInput,
  FailedEventFilters,
  ProcessedAction,
  CalendarPreview,
  CreateCalendarPreviewInput,
  UpdateCalendarPreviewInput,
} from './models.js';
import type { CalendarError } from './errors.js';

export interface GoogleCalendarClient {
  getCalendarTimezone(
    accessToken: string,
    calendarId: string,
    logger: Logger
  ): Promise<Result<string, CalendarError>>;

  listEvents(
    accessToken: string,
    calendarId: string,
    options: ListEventsInput,
    logger: Logger
  ): Promise<Result<CalendarEvent[], CalendarError>>;

  getEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    logger: Logger
  ): Promise<Result<CalendarEvent, CalendarError>>;

  createEvent(
    accessToken: string,
    calendarId: string,
    event: CreateEventInput,
    logger: Logger
  ): Promise<Result<CalendarEvent, CalendarError>>;

  updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: UpdateEventInput,
    logger: Logger
  ): Promise<Result<CalendarEvent, CalendarError>>;

  deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    logger: Logger
  ): Promise<Result<void, CalendarError>>;

  getFreeBusy(
    accessToken: string,
    input: FreeBusyInput,
    logger: Logger
  ): Promise<Result<Map<string, FreeBusySlot[]>, CalendarError>>;
}

export interface OAuthTokenResult {
  accessToken: string;
  email: string;
}

export interface UserServiceClient {
  getOAuthToken(userId: string): Promise<Result<OAuthTokenResult, CalendarError>>;
}

export interface FailedEventRepository {
  create(input: CreateFailedEventInput): Promise<Result<FailedEvent, CalendarError>>;
  list(userId: string, filters?: FailedEventFilters): Promise<Result<FailedEvent[], CalendarError>>;
  get(id: string): Promise<Result<FailedEvent | null, CalendarError>>;
  delete(id: string): Promise<Result<void, CalendarError>>;
}

export interface ExtractionError {
  code: 'NO_API_KEY' | 'USER_SERVICE_ERROR' | 'GENERATION_ERROR' | 'INVALID_RESPONSE';
  message: string;
  details?: {
    llmErrorCode?: string;
    parseError?: string;
    rawResponsePreview?: string;
    userServiceError?: string;
    wasWrappedInMarkdown?: boolean;
    originalLength?: number;
    cleanedLength?: number;
  };
}

export interface ExtractedCalendarEvent {
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  description: string | null;
  valid: boolean;
  error: string | null;
  reasoning: string;
}

export interface CalendarActionExtractionService {
  extractEvent(
    userId: string,
    text: string,
    currentDate: string
  ): Promise<Result<ExtractedCalendarEvent, ExtractionError>>;
}

/** Repository for tracking successfully processed actions (idempotency) */
export interface ProcessedActionRepository {
  /** Get a processed action by actionId */
  getByActionId(actionId: string): Promise<Result<ProcessedAction | null, CalendarError>>;

  /** Save a successfully processed action */
  create(input: {
    actionId: string;
    userId: string;
    eventId: string;
    resourceUrl: string;
  }): Promise<Result<ProcessedAction, CalendarError>>;
}

/**
 * Repository for calendar event previews.
 * Previews are generated async after action creation to show users
 * what event will be created before they approve.
 */
export interface CalendarPreviewRepository {
  /** Get a preview by actionId */
  getByActionId(actionId: string): Promise<Result<CalendarPreview | null, CalendarError>>;

  /** Create a new preview */
  create(input: CreateCalendarPreviewInput): Promise<Result<CalendarPreview, CalendarError>>;

  /** Update an existing preview */
  update(actionId: string, updates: UpdateCalendarPreviewInput): Promise<Result<void, CalendarError>>;

  /** Delete a preview by actionId */
  delete(actionId: string): Promise<Result<void, CalendarError>>;
}
