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

/**
 * A failed calendar event extraction that couldn't be processed.
 * Stored for manual review and potential retry.
 */
export interface FailedEvent {
  id: string;
  /** User ID who requested the event creation */
  userId: string;
  /** Original action ID from actions-agent */
  actionId: string;
  /** Original user message text */
  originalText: string;
  /** Extracted summary (may be partial) */
  summary: string;
  /** Parsed start time (null if unparseable) */
  start: string | null;
  /** Parsed end time (null if not specified) */
  end: string | null;
  /** Parsed location (null if not specified) */
  location: string | null;
  /** Parsed description (null if not specified) */
  description: string | null;
  /** Error message explaining why validation failed */
  error: string;
  /** LLM reasoning for extraction decisions */
  reasoning: string;
  /** When the failed event was created */
  createdAt: Date;
}

/** Input for creating a new failed event entry */
export interface CreateFailedEventInput {
  userId: string;
  actionId: string;
  originalText: string;
  summary: string;
  start: string | null;
  end: string | null;
  location: string | null;
  description: string | null;
  error: string;
  reasoning: string;
}

/** Filters for listing failed events */
export interface FailedEventFilters {
  limit?: number;
}

/** Successfully processed calendar action record for idempotency */
export interface ProcessedAction {
  actionId: string;
  userId: string;
  eventId: string;
  resourceUrl: string;
  createdAt: string;
}

/** Calendar event preview status */
export type CalendarPreviewStatus = 'pending' | 'ready' | 'failed';

/**
 * Preview of a calendar event before execution.
 * Generated asynchronously after action creation to show users
 * what event will be created before they approve.
 */
export interface CalendarPreview {
  /** Action ID this preview belongs to */
  actionId: string;
  /** User ID who owns the action */
  userId: string;
  /** Preview generation status */
  status: CalendarPreviewStatus;
  /** Event title/summary */
  summary?: string;
  /** Event start time in ISO format */
  start?: string;
  /** Event end time in ISO format (null for open-ended) */
  end?: string | null;
  /** Event location (null if not specified) */
  location?: string | null;
  /** Event description (null if not specified) */
  description?: string | null;
  /** Duration string (e.g., "1 hour", "30 minutes") */
  duration?: string | null;
  /** Whether this is an all-day event */
  isAllDay?: boolean;
  /** Error message if generation failed */
  error?: string;
  /** LLM reasoning for extraction decisions */
  reasoning?: string;
  /** When the preview was generated */
  generatedAt: string;
}

/** Input for creating a new calendar preview */
export interface CreateCalendarPreviewInput {
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
}

/** Input for updating an existing calendar preview */
export interface UpdateCalendarPreviewInput {
  status?: CalendarPreviewStatus;
  summary?: string;
  start?: string;
  end?: string | null;
  location?: string | null;
  description?: string | null;
  duration?: string | null;
  isAllDay?: boolean;
  error?: string;
  reasoning?: string;
}
