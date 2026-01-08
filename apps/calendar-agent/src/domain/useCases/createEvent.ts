/**
 * Create Event Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent, CreateEventInput } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface CreateEventDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
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
  const { userServiceClient, googleCalendarClient } = deps;

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    return err(tokenResult.error);
  }

  return await googleCalendarClient.createEvent(
    tokenResult.value.accessToken,
    calendarId,
    event
  );
}
