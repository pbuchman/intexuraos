/**
 * Get Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface GetEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger: Logger;
}

export interface GetEventRequest {
  userId: string;
  calendarId?: string;
  eventId: string;
}

export async function getEvent(
  request: GetEventRequest,
  deps: GetEventDeps
): Promise<Result<CalendarEvent, CalendarError>> {
  const { userId, calendarId = 'primary', eventId } = request;
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger.info({ userId, calendarId, eventId }, 'getEvent: entry');

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    logger.error({ userId, calendarId, eventId, error: tokenResult.error }, 'getEvent: failed to get OAuth token');
    return err(tokenResult.error);
  }

  const result = await googleCalendarClient.getEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    logger
  );

  if (result.ok) {
    logger.info({ userId, calendarId, eventId, title: result.value.summary }, 'getEvent: success');
  } else {
    logger.error({ userId, calendarId, eventId, error: result.error }, 'getEvent: failed to get event');
  }

  return result;
}
