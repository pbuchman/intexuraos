/**
 * Calendar domain models.
 */

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  created?: string;
  updated?: string;
  organizer?: EventPerson;
  attendees?: EventAttendee[];
}

export interface EventDateTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

export interface EventPerson {
  email?: string;
  displayName?: string;
  self?: boolean;
}

export interface EventAttendee extends EventPerson {
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  optional?: boolean;
}

export interface FreeBusySlot {
  start: string;
  end: string;
}

export interface CreateEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: EventDateTime;
  end: EventDateTime;
  attendees?: { email: string }[];
}

export interface UpdateEventInput {
  summary?: string;
  description?: string;
  location?: string;
  start?: EventDateTime;
  end?: EventDateTime;
  attendees?: { email: string }[];
}

export interface ListEventsInput {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  singleEvents?: boolean;
  orderBy?: 'startTime' | 'updated';
  q?: string;
}

export interface FreeBusyInput {
  timeMin: string;
  timeMax: string;
  items?: { id: string }[];
}
