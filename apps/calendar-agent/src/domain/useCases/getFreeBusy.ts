/**
 * Get Free/Busy Use Case
 */

import { err, type Result } from '@intexuraos/common-core';
import type { CalendarError } from '../errors.js';
import type { FreeBusyInput, FreeBusySlot } from '../models.js';
import type { GoogleCalendarClient, UserServiceClient } from '../ports.js';

export interface GetFreeBusyDeps {
  userServiceClient: UserServiceClient;
  googleCalendarClient: GoogleCalendarClient;
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
  const { userServiceClient, googleCalendarClient } = deps;

  const tokenResult = await userServiceClient.getOAuthToken(userId);
  if (!tokenResult.ok) {
    return err(tokenResult.error);
  }

  return await googleCalendarClient.getFreeBusy(tokenResult.value.accessToken, input);
}
