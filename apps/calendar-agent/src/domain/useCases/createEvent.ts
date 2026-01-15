/**
 * Create Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent, CreateEventInput } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface CreateEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger: Logger;
}

export interface CreateEventRequest {
  userId: string;
  calendarId?: string;
  event: CreateEventInput;
}

export async function createEvent(
  request: CreateEventRequest,
  deps: CreateEventDeps
): Promise<Result<CalendarEvent, CalendarError>> {
  const { userId, calendarId = 'primary', event } = request;
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger.info({ userId, calendarId, title: event.summary }, 'createEvent: entry');

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    logger.error({ userId, calendarId, error: tokenResult.error }, 'createEvent: failed to get OAuth token');
    return err(tokenResult.error);
  }

  const result = await googleCalendarClient.createEvent(
    tokenResult.value.accessToken,
    calendarId,
    event,
    logger
  );

  if (result.ok) {
    logger.info({ userId, calendarId, eventId: result.value.id }, 'createEvent: success');
  } else {
    logger.error({ userId, calendarId, error: result.error }, 'createEvent: failed to create event');
  }

  return result;
}
