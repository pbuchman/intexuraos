/**
 * Update Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent, UpdateEventInput } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface UpdateEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger?: Logger;
}

export interface UpdateEventRequest {
  userId: string;
  calendarId?: string;
  eventId: string;
  event: UpdateEventInput;
}

export async function updateEvent(
  request: UpdateEventRequest,
  deps: UpdateEventDeps
): Promise<Result<CalendarEvent, CalendarError>> {
  const { userId, calendarId = 'primary', eventId, event } = request;
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger?.info({ userId, calendarId, eventId, updates: Object.keys(event) }, 'updateEvent: entry');

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    logger?.error({ userId, calendarId, eventId, error: tokenResult.error }, 'updateEvent: failed to get OAuth token');
    return err(tokenResult.error);
  }

  const result = await googleCalendarClient.updateEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    event,
    logger
  );

  if (result.ok) {
    logger?.info({ userId, calendarId, eventId, title: result.value.summary }, 'updateEvent: success');
  } else {
    logger?.error({ userId, calendarId, eventId, error: result.error }, 'updateEvent: failed to update event');
  }

  return result;
}
