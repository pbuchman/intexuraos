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
} from './models.js';
import type { CalendarError } from './errors.js';

export interface GoogleCalendarClient {
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
