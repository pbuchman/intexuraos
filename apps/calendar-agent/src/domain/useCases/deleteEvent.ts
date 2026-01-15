/**
 * Delete Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface DeleteEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger: Logger;
}

export interface DeleteEventRequest {
  userId: string;
  calendarId?: string;
  eventId: string;
}

export async function deleteEvent(
  request: DeleteEventRequest,
  deps: DeleteEventDeps
): Promise<Result<void, CalendarError>> {
  const { userId, calendarId = 'primary', eventId } = request;
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger.info({ userId, calendarId, eventId }, 'deleteEvent: entry');

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    logger.error({ userId, calendarId, eventId, error: tokenResult.error }, 'deleteEvent: failed to get OAuth token');
    return err(tokenResult.error);
  }

  const result = await googleCalendarClient.deleteEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    logger
  );

  if (result.ok) {
    logger.info({ userId, calendarId, eventId }, 'deleteEvent: success');
  } else {
    logger.error({ userId, calendarId, eventId, error: result.error }, 'deleteEvent: failed to delete event');
  }

  return result;
}
