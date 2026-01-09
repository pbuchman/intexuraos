/**
 * List Events Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent, ListEventsInput } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface ListEventsDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
}

export interface ListEventsRequest {
  userId: string;
  calendarId?: string;
  options?: ListEventsInput;
}

export async function listEvents(
  request: ListEventsRequest,
  deps: ListEventsDeps
): Promise<Result<CalendarEvent[], CalendarError>> {
  const { userId, calendarId = 'primary', options = {} } = request;
  const { userServiceClient, googleCalendarClient } = deps;

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    return err(tokenResult.error);
  }

  return await googleCalendarClient.listEvents(
    tokenResult.value.accessToken,
    calendarId,
    options
  );
}
