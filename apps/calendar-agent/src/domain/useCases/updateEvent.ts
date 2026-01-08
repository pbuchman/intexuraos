/**
 * Update Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent, UpdateEventInput } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface UpdateEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
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
  const { userServiceClient, googleCalendarClient } = deps;

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    return err(tokenResult.error);
  }

  return await googleCalendarClient.updateEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId,
    event
  );
}
