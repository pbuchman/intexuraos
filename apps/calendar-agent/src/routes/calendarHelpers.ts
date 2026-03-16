/**
 * Calendar route helpers — builder functions and interface types.
 */
import type {
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
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; optional?: boolean }[];
}

export interface UpdateEventBody {
  calendarId?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email: string; optional?: boolean }[];
}

export interface FreeBusyBody {
  timeMin: string;
  timeMax: string;
  items?: { id: string }[];
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
    start: body.start,
    end: body.end,
  };
  if (body.description !== undefined) input.description = body.description;
  if (body.location !== undefined) input.location = body.location;
  if (body.attendees !== undefined) input.attendees = body.attendees;
  return input;
}

export function buildUpdateEventInput(body: UpdateEventBody): UpdateEventInput {
  const input: UpdateEventInput = {};
  if (body.summary !== undefined) input.summary = body.summary;
  if (body.description !== undefined) input.description = body.description;
  if (body.location !== undefined) input.location = body.location;
  if (body.start !== undefined) input.start = body.start;
  if (body.end !== undefined) input.end = body.end;
  if (body.attendees !== undefined) input.attendees = body.attendees;
  return input;
}
