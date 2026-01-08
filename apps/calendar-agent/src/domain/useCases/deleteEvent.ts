/**
 * Delete Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface DeleteEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
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
  const { userServiceClient, googleCalendarClient } = deps;

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    return err(tokenResult.error);
  }

  return await googleCalendarClient.deleteEvent(
    tokenResult.value.accessToken,
    calendarId,
    eventId
  );
}
