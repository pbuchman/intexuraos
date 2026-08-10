import { err, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import { mapUserServiceError } from '../errors.js';
import type { CalendarEvent } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface AddEventAttendeesDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger: Logger;
}

export interface AddEventAttendeesRequest {
  userId: string;
  calendarId: string;
  eventId: string;
  expectedEtag: string;
  attendeesToAdd: { email: string }[];
}

export async function addEventAttendees(
  request: AddEventAttendeesRequest,
  deps: AddEventAttendeesDeps
): Promise<Result<CalendarEvent, CalendarError>> {
  const {
    userId,
    calendarId,
    eventId,
    expectedEtag,
    attendeesToAdd,
  } = request;
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger.info(
    { userId, calendarId, eventId, attendeeCount: attendeesToAdd.length },
    'addEventAttendees: entry'
  );

  const confirmedVersion: unknown = expectedEtag;
  if (typeof confirmedVersion !== 'string' || confirmedVersion.trim() === '') {
    logger.error(
      { userId, calendarId, eventId },
      'addEventAttendees: confirmed event version unavailable'
    );
    return err({ code: 'INTERNAL_ERROR', message: 'Calendar event version unavailable' });
  }

  const tokenResult = await userServiceClient.getOAuthToken(userId, 'google');
  if (!tokenResult.ok) {
    logger.error(
      { userId, calendarId, eventId, error: tokenResult.error },
      'addEventAttendees: failed to get OAuth token'
    );
    return err(mapUserServiceError(tokenResult.error));
  }

  const eventResult = await googleCalendarClient.getEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    logger
  );
  if (!eventResult.ok) {
    logger.error(
      { userId, calendarId, eventId, error: eventResult.error },
      'addEventAttendees: failed to get event'
    );
    return eventResult;
  }
  if (eventResult.value.etag !== expectedEtag) {
    logger.warn(
      { userId, calendarId, eventId },
      'addEventAttendees: confirmed event snapshot is stale'
    );
    return err({
      code: 'CONFLICT',
      message: 'Calendar event changed after confirmation; repeat the request',
    });
  }
  if (eventResult.value.attendeesOmitted === true) {
    logger.error(
      { userId, calendarId, eventId },
      'addEventAttendees: current attendee list is incomplete'
    );
    return err({ code: 'INTERNAL_ERROR', message: 'Calendar attendee list is incomplete' });
  }

  const existingAttendees = eventResult.value.attendees ?? [];
  const existingEmails = new Set(
    existingAttendees.flatMap((attendee) =>
      attendee.email === undefined ? [] : [attendee.email.toLowerCase()]
    )
  );
  const mergedAttendees = [...existingAttendees];

  for (const attendee of attendeesToAdd) {
    const normalizedEmail = attendee.email.toLowerCase();
    if (!existingEmails.has(normalizedEmail)) {
      mergedAttendees.push(attendee);
      existingEmails.add(normalizedEmail);
    }
  }

  if (mergedAttendees.length === existingAttendees.length) {
    logger.info(
      { userId, calendarId, eventId },
      'addEventAttendees: attendees already present'
    );
    return eventResult;
  }

  const updateResult = await googleCalendarClient.updateEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    { attendees: mergedAttendees },
    logger,
    { sendUpdates: 'all', expectedEtag }
  );

  if (updateResult.ok) {
    logger.info(
      { userId, calendarId, eventId, attendeeCount: mergedAttendees.length },
      'addEventAttendees: success'
    );
  } else {
    logger.error(
      { userId, calendarId, eventId, error: updateResult.error },
      'addEventAttendees: failed to update event'
    );
  }

  return updateResult;
}
