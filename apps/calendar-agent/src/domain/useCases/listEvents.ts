/**
 * List Events Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { CalendarEvent, ListEventsInput } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface ListEventsDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger: Logger;
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
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger.info({ userId, calendarId, options }, 'listEvents: entry');

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    logger.error({ userId, calendarId, error: tokenResult.error }, 'listEvents: failed to get OAuth token');
    return err(tokenResult.error);
  }

  const result = await googleCalendarClient.listEvents(
    tokenResult.value.accessToken,
    calendarId,
    options,
    logger
  );

  if (result.ok) {
    logger.info({ userId, calendarId, eventCount: result.value.length }, 'listEvents: success');
  } else {
    logger.error({ userId, calendarId, error: result.error }, 'listEvents: failed to list events');
  }

  return result;
}
