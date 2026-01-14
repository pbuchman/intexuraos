/**
 * Get Free/Busy Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { FreeBusyInput, FreeBusySlot } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface GetFreeBusyDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
  logger?: Logger;
}

export interface GetFreeBusyRequest {
  userId: string;
  input: FreeBusyInput;
}

export async function getFreeBusy(
  request: GetFreeBusyRequest,
  deps: GetFreeBusyDeps
): Promise<Result<Map<string, FreeBusySlot[]>, CalendarError>> {
  const { userId, input } = request;
  const { userServiceClient, googleCalendarClient, logger } = deps;

  logger?.info({ userId, timeMin: input.timeMin, timeMax: input.timeMax, calendarCount: input.items?.length ?? 1 }, 'getFreeBusy: entry');

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    logger?.error({ userId, error: tokenResult.error }, 'getFreeBusy: failed to get OAuth token');
    return err(tokenResult.error);
  }

  const result = await googleCalendarClient.getFreeBusy(tokenResult.value.accessToken, input, logger);

  if (result.ok) {
    logger?.info({ userId, calendarCount: result.value.size }, 'getFreeBusy: success');
  } else {
    logger?.error({ userId, error: result.error }, 'getFreeBusy: failed to get free/busy');
  }

  return result;
}
