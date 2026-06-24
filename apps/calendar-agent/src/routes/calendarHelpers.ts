/**
 * Calendar route helpers — builder functions and interface types.
 */
import type {
  EventDateTime,
  ListEventsInput,
  CreateEventInput,
  UpdateEventInput,
} from '../domain/index.js';

export interface ListEventsQuery {
  calendarId?: string;
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  q?: string;
}

export interface EventParams {
  eventId: string;
}

export interface CalendarIdQuery {
  calendarId?: string;
}

export interface CreateEventBody {
  calendarId?: string;
  summary: string;
  description?: string | undefined;
  location?: string | undefined;
  start: EventDateTimeBody;
  end: EventDateTimeBody;
  attendees?: { email: string; optional?: boolean | undefined }[] | undefined;
}

export interface UpdateEventBody {
  calendarId?: string;
  summary?: string | undefined;
  description?: string | undefined;
  location?: string | undefined;
  start?: EventDateTimeBody | undefined;
  end?: EventDateTimeBody | undefined;
  attendees?: { email: string; optional?: boolean | undefined }[] | undefined;
}

export interface FreeBusyBody {
  timeMin: string;
  timeMax: string;
  items?: { id: string }[];
}

export interface CalendarDomainError {
  code: string;
  message: string;
}

interface EventDateTimeBody {
  dateTime?: string | undefined;
  date?: string | undefined;
  timeZone?: string | undefined;
}

export function buildListEventsOptions(query: ListEventsQuery): ListEventsInput {
  const options: ListEventsInput = {};
  if (query.timeMin !== undefined) options.timeMin = query.timeMin;
  if (query.timeMax !== undefined) options.timeMax = query.timeMax;
  if (query.maxResults !== undefined) options.maxResults = query.maxResults;
  if (query.q !== undefined) options.q = query.q;
  return options;
}

export function buildCreateEventInput(body: CreateEventBody): CreateEventInput {
  const input: CreateEventInput = {
    summary: body.summary,
    start: buildEventDateTimeInput(body.start),
    end: buildEventDateTimeInput(body.end),
  };
  if (body.description !== undefined) input.description = body.description;
  if (body.location !== undefined) input.location = body.location;
  if (body.attendees !== undefined) {
    input.attendees = body.attendees.map((attendee) => ({ email: attendee.email }));
  }
  return input;
}

export function buildUpdateEventInput(body: UpdateEventBody): UpdateEventInput {
  const input: UpdateEventInput = {};
  if (body.summary !== undefined) input.summary = body.summary;
  if (body.description !== undefined) input.description = body.description;
  if (body.location !== undefined) input.location = body.location;
  if (body.start !== undefined) input.start = buildEventDateTimeInput(body.start);
  if (body.end !== undefined) input.end = buildEventDateTimeInput(body.end);
  if (body.attendees !== undefined) {
    input.attendees = body.attendees.map((attendee) => ({ email: attendee.email }));
  }
  return input;
}

function buildEventDateTimeInput(body: EventDateTimeBody): EventDateTime {
  const input: EventDateTime = {};
  if (body.dateTime !== undefined) input.dateTime = body.dateTime;
  if (body.date !== undefined) input.date = body.date;
  if (body.timeZone !== undefined) input.timeZone = body.timeZone;
  return input;
}
