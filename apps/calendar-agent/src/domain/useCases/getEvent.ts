/**
 * Get Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface GetEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
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
  const { userServiceClient, googleCalendarClient } = deps;

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    return err(tokenResult.error);
  }

  return await googleCalendarClient.getEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId
  );
}
