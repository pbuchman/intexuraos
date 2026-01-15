/**
 * Google Calendar API client implementation.
 */

import { google, type calendar_v3 } from 'googleapis';
import { err, ok, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type {
  CalendarEvent,
  CreateEventInput,
  EventAttendee,
  EventPerson,
  FreeBusyInput,
  FreeBusySlot,
  ListEventsInput,
  UpdateEventInput,
} from '../../domain/models.js';
import type { CalendarError } from '../../domain/errors.js';
import type { GoogleCalendarClient } from '../../domain/ports.js';

type GoogleEvent = calendar_v3.Schema$Event;

function buildEventDateTime(dt: GoogleEvent['start']): CalendarEvent['start'] {
  const result: CalendarEvent['start'] = {};
  if (dt?.dateTime !== undefined && dt.dateTime !== null) {
    result.dateTime = dt.dateTime;
  }
  if (dt?.date !== undefined && dt.date !== null) {
    result.date = dt.date;
  }
  if (dt?.timeZone !== undefined && dt.timeZone !== null) {
    result.timeZone = dt.timeZone;
  }
  return result;
}

function buildEventPerson(person: { email?: string | null; displayName?: string | null; self?: boolean | null } | null | undefined): EventPerson | undefined {
  if (person === undefined || person === null) {
    return undefined;
  }
  const result: EventPerson = {};
  if (person.email !== undefined && person.email !== null) {
    result.email = person.email;
  }
  if (person.displayName !== undefined && person.displayName !== null) {
    result.displayName = person.displayName;
  }
  if (person.self !== undefined && person.self !== null) {
    result.self = person.self;
  }
  return result;
}

function buildEventAttendee(attendee: calendar_v3.Schema$EventAttendee): EventAttendee {
  const result: EventAttendee = {};
  if (attendee.email !== undefined && attendee.email !== null) {
    result.email = attendee.email;
  }
  if (attendee.displayName !== undefined && attendee.displayName !== null) {
    result.displayName = attendee.displayName;
  }
  if (attendee.self !== undefined && attendee.self !== null) {
    result.self = attendee.self;
  }
  const rs = attendee.responseStatus;
  if (rs === 'needsAction' || rs === 'declined' || rs === 'tentative' || rs === 'accepted') {
    result.responseStatus = rs;
  }
  if (attendee.optional !== undefined && attendee.optional !== null) {
    result.optional = attendee.optional;
  }
  return result;
}

function mapGoogleEventToCalendarEvent(event: GoogleEvent): CalendarEvent {
  const result: CalendarEvent = {
    id: event.id ?? '',
    summary: event.summary ?? '',
    start: buildEventDateTime(event.start),
    end: buildEventDateTime(event.end),
  };

  if (event.description !== undefined && event.description !== null) {
    result.description = event.description;
  }
  if (event.location !== undefined && event.location !== null) {
    result.location = event.location;
  }
  const status = event.status;
  if (status === 'confirmed' || status === 'tentative' || status === 'cancelled') {
    result.status = status;
  }
  if (event.htmlLink !== undefined && event.htmlLink !== null) {
    result.htmlLink = event.htmlLink;
  }
  if (event.created !== undefined && event.created !== null) {
    result.created = event.created;
  }
  if (event.updated !== undefined && event.updated !== null) {
    result.updated = event.updated;
  }
  const organizer = buildEventPerson(event.organizer);
  if (organizer !== undefined) {
    result.organizer = organizer;
  }
  if (event.attendees !== undefined) {
    result.attendees = event.attendees.map(buildEventAttendee);
  }

  return result;
}

export function mapErrorToCalendarError(error: unknown): CalendarError {
  // Try to extract status from Google API error structure
  const googleError = error as {
    response?: {
      status?: number;
      data?: {
        error?: {
          code?: number;
          message?: string;
          errors?: { reason?: string }[];
        };
      };
    };
    code?: number;
    message?: string;
  };

  let code: number | undefined;
  let message: string;
  let apiErrors: { reason?: string }[] | undefined;

  if (googleError.response?.data?.error) {
    // Google API error format: { response: { data: { error: { code, message, errors } } } }
    const apiError = googleError.response.data.error;
    code = apiError.code;
    message = apiError.message ?? 'Unknown error';
    apiErrors = apiError.errors;
  } else if (googleError.code !== undefined) {
    // Direct error format: { code, message }
    code = googleError.code;
    message = googleError.message ?? 'Unknown error';
  } else {
    // Unknown error format
    message = 'Unknown error';
  }

  if (code === 404) {
    return { code: 'NOT_FOUND', message };
  }
  if (code === 401) {
    return { code: 'TOKEN_ERROR', message };
  }
  if (code === 403) {
    const reason = apiErrors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'rateLimitExceeded') {
      return { code: 'QUOTA_EXCEEDED', message };
    }
    return { code: 'PERMISSION_DENIED', message };
  }
  if (code === 400) {
    return { code: 'INVALID_REQUEST', message };
  }

  return { code: 'INTERNAL_ERROR', message, details: error };
}

function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export class GoogleCalendarClientImpl implements GoogleCalendarClient {
  async listEvents(
    accessToken: string,
    calendarId: string,
    options: ListEventsInput,
    logger: Logger
  ): Promise<Result<CalendarEvent[], CalendarError>> {
    logger.debug({ calendarId, options }, 'GoogleCalendarClient.listEvents: request');
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const params = filterUndefined({
        calendarId,
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        maxResults: options.maxResults,
        singleEvents: options.singleEvents,
        orderBy: options.orderBy,
        q: options.q,
      });

      const response = await calendar.events.list(params);
      const events = (response.data.items ?? []).map(mapGoogleEventToCalendarEvent);
      logger.debug({ calendarId, eventCount: events.length }, 'GoogleCalendarClient.listEvents: response');
      return ok(events);
    } catch (error) {
      const calendarError = mapErrorToCalendarError(error);
      logger.error({ calendarId, error: calendarError }, 'GoogleCalendarClient.listEvents: error');
      return err(calendarError);
    }
  }

  async getEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    logger: Logger
  ): Promise<Result<CalendarEvent, CalendarError>> {
    logger.debug({ calendarId, eventId }, 'GoogleCalendarClient.getEvent: request');
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const response = await calendar.events.get({ calendarId, eventId });
      logger.debug({ calendarId, eventId, title: response.data.summary }, 'GoogleCalendarClient.getEvent: response');
      return ok(mapGoogleEventToCalendarEvent(response.data));
    } catch (error) {
      const calendarError = mapErrorToCalendarError(error);
      logger.error({ calendarId, eventId, error: calendarError }, 'GoogleCalendarClient.getEvent: error');
      return err(calendarError);
    }
  }

  async createEvent(
    accessToken: string,
    calendarId: string,
    event: CreateEventInput,
    logger: Logger
  ): Promise<Result<CalendarEvent, CalendarError>> {
    logger.debug({ calendarId, title: event.summary }, 'GoogleCalendarClient.createEvent: request');
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const requestBody = filterUndefined({
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        attendees: event.attendees,
      });

      const response = await calendar.events.insert({
        calendarId,
        requestBody,
      });
      logger.debug({ calendarId, eventId: response.data.id }, 'GoogleCalendarClient.createEvent: response');
      return ok(mapGoogleEventToCalendarEvent(response.data));
    } catch (error) {
      const calendarError = mapErrorToCalendarError(error);
      logger.error({ calendarId, error: calendarError }, 'GoogleCalendarClient.createEvent: error');
      return err(calendarError);
    }
  }

  async updateEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    event: UpdateEventInput,
    logger: Logger
  ): Promise<Result<CalendarEvent, CalendarError>> {
    logger.debug({ calendarId, eventId, updates: Object.keys(event) }, 'GoogleCalendarClient.updateEvent: request');
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const requestBody = filterUndefined({
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: event.start,
        end: event.end,
        attendees: event.attendees,
      });

      const response = await calendar.events.patch({
        calendarId,
        eventId,
        requestBody,
      });
      logger.debug({ calendarId, eventId, title: response.data.summary }, 'GoogleCalendarClient.updateEvent: response');
      return ok(mapGoogleEventToCalendarEvent(response.data));
    } catch (error) {
      const calendarError = mapErrorToCalendarError(error);
      logger.error({ calendarId, eventId, error: calendarError }, 'GoogleCalendarClient.updateEvent: error');
      return err(calendarError);
    }
  }

  async deleteEvent(
    accessToken: string,
    calendarId: string,
    eventId: string,
    logger: Logger
  ): Promise<Result<void, CalendarError>> {
    logger.debug({ calendarId, eventId }, 'GoogleCalendarClient.deleteEvent: request');
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      await calendar.events.delete({ calendarId, eventId });
      logger.debug({ calendarId, eventId }, 'GoogleCalendarClient.deleteEvent: response');
      return ok(undefined);
    } catch (error) {
      const calendarError = mapErrorToCalendarError(error);
      logger.error({ calendarId, eventId, error: calendarError }, 'GoogleCalendarClient.deleteEvent: error');
      return err(calendarError);
    }
  }

  async getFreeBusy(
    accessToken: string,
    input: FreeBusyInput,
    logger: Logger
  ): Promise<Result<Map<string, FreeBusySlot[]>, CalendarError>> {
    logger.debug({ timeMin: input.timeMin, timeMax: input.timeMax, calendarCount: input.items?.length ?? 1 }, 'GoogleCalendarClient.getFreeBusy: request');
    try {
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const items = input.items ?? [{ id: 'primary' }];

      const response = await calendar.freebusy.query({
        requestBody: {
          timeMin: input.timeMin,
          timeMax: input.timeMax,
          items,
        },
      });

      const result = new Map<string, FreeBusySlot[]>();
      const calendars = response.data.calendars ?? {};

      for (const [calId, data] of Object.entries(calendars)) {
        const calendarData = data as { busy?: { start?: string; end?: string }[] };
        const slots: FreeBusySlot[] = (calendarData.busy ?? []).map((slot) => ({
          start: slot.start ?? '',
          end: slot.end ?? '',
        }));
        result.set(calId, slots);
      }

      logger.debug({ calendarCount: result.size }, 'GoogleCalendarClient.getFreeBusy: response');
      return ok(result);
    } catch (error) {
      const calendarError = mapErrorToCalendarError(error);
      logger.error({ error: calendarError }, 'GoogleCalendarClient.getFreeBusy: error');
      return err(calendarError);
    }
  }
}
