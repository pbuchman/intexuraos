import { err, type Logger, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import { mapUserServiceError } from '../errors.js';
import type { CalendarEvent, EventDateTime, UpdateEventInput } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface UpdateExistingEventChanges {
  summary?: string;
  description?: string | null;
  location?: string | null;
  start?: EventDateTime;
  end?: EventDateTime;
  attendeesToAdd?: { email: string }[];
  attendeesToRemove?: { email: string }[];
}

export interface UpdateExistingEventRequest {
  userId: string;
  calendarId: string;
  eventId: string;
  expectedEtag: string;
  changes: UpdateExistingEventChanges;
}

export interface UpdateExistingEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger: Logger;
}

export async function updateExistingEvent(
  request: UpdateExistingEventRequest,
  deps: UpdateExistingEventDeps
): Promise<Result<CalendarEvent, CalendarError>> {
  const { userId, calendarId, eventId, expectedEtag, changes } = request;
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger.info(
    { userId, calendarId, eventId, updates: Object.keys(changes) },
    'updateExistingEvent: entry'
  );

  const confirmedVersion: unknown = expectedEtag;
  if (typeof confirmedVersion !== 'string' || confirmedVersion.trim() === '') {
    logger.error({ userId, calendarId, eventId }, 'updateExistingEvent: event version unavailable');
    return err({ code: 'INTERNAL_ERROR', message: 'Calendar event version unavailable' });
  }

  const tokenResult = await userServiceClient.getOAuthToken(userId, 'google');
  if (!tokenResult.ok) {
    logger.error(
      { userId, calendarId, eventId, error: tokenResult.error },
      'updateExistingEvent: failed to get OAuth token'
    );
    return err(mapUserServiceError(tokenResult.error));
  }

  const currentEventResult = await googleCalendarClient.getEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    logger
  );
  if (!currentEventResult.ok) {
    logger.error(
      { userId, calendarId, eventId, error: currentEventResult.error },
      'updateExistingEvent: failed to get event'
    );
    return currentEventResult;
  }

  const currentEvent = currentEventResult.value;
  if (currentEvent.etag !== expectedEtag) {
    logger.warn({ userId, calendarId, eventId }, 'updateExistingEvent: confirmed snapshot is stale');
    return err({
      code: 'CONFLICT',
      message: 'Calendar event changed after confirmation; repeat the request',
    });
  }

  const attendeeChangesRequested =
    changes.attendeesToAdd !== undefined || changes.attendeesToRemove !== undefined;
  if (attendeeChangesRequested && currentEvent.attendeesOmitted === true) {
    logger.error(
      { userId, calendarId, eventId },
      'updateExistingEvent: current attendee list is incomplete'
    );
    return err({ code: 'INTERNAL_ERROR', message: 'Calendar attendee list is incomplete' });
  }

  const patch = buildEventPatch(changes, currentEvent);
  const attendeePatch = patch.attendees;
  if (
    Object.keys(patch).length === 1 &&
    attendeePatch?.length === (currentEvent.attendees ?? []).length &&
    attendeePatch.every((attendee, index) => attendee === currentEvent.attendees?.[index])
  ) {
    logger.info({ userId, calendarId, eventId }, 'updateExistingEvent: no changes required');
    return currentEventResult;
  }
  const updateResult = await googleCalendarClient.updateEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    patch,
    logger,
    attendeeChangesRequested
      ? { sendUpdates: 'all', expectedEtag }
      : { expectedEtag }
  );

  if (updateResult.ok) {
    logger.info({ userId, calendarId, eventId }, 'updateExistingEvent: success');
  } else {
    logger.error(
      { userId, calendarId, eventId, error: updateResult.error },
      'updateExistingEvent: failed to update event'
    );
  }
  return updateResult;
}

function buildEventPatch(
  changes: UpdateExistingEventChanges,
  currentEvent: CalendarEvent
): UpdateEventInput {
  const patch: UpdateEventInput = {};
  if (changes.summary !== undefined) patch.summary = changes.summary;
  if (changes.description !== undefined) patch.description = changes.description ?? '';
  if (changes.location !== undefined) patch.location = changes.location ?? '';
  if (changes.start !== undefined) patch.start = changes.start;
  if (changes.end !== undefined) patch.end = changes.end;

  if (changes.attendeesToAdd !== undefined || changes.attendeesToRemove !== undefined) {
    const emailsToRemove = new Set(
      (changes.attendeesToRemove ?? []).map(({ email }) => email.toLowerCase())
    );
    const attendees = (currentEvent.attendees ?? []).filter(
      ({ email }) => email === undefined || !emailsToRemove.has(email.toLowerCase())
    );
    const retainedEmails = new Set(
      attendees.flatMap(({ email }) => (email === undefined ? [] : [email.toLowerCase()]))
    );
    for (const attendee of changes.attendeesToAdd ?? []) {
      const normalizedEmail = attendee.email.toLowerCase();
      if (!retainedEmails.has(normalizedEmail)) {
        attendees.push(attendee);
        retainedEmails.add(normalizedEmail);
      }
    }
    patch.attendees = attendees;
  }

  return patch;
}
