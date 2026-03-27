import { config } from '@/config';
import { apiRequest } from './apiClient.js';

export interface UserTimezoneSettings {
  userId: string;
  timezone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatchTimezoneResponse {
  timezone: string;
}

/**
 * Get user settings (including timezone) from user-service.
 */
export async function getUserTimezoneSettings(
  accessToken: string,
  userId: string
): Promise<UserTimezoneSettings> {
  return await apiRequest<UserTimezoneSettings>(
    config.authServiceUrl,
    `/users/${encodeURIComponent(userId)}/settings`,
    accessToken
  );
}

/**
 * PATCH the user's timezone to user-service.
 */
export async function patchUserTimezone(
  accessToken: string,
  userId: string,
  timezone: string
): Promise<PatchTimezoneResponse> {
  return await apiRequest<PatchTimezoneResponse>(
    config.authServiceUrl,
    `/users/${encodeURIComponent(userId)}/settings/timezone`,
    accessToken,
    { method: 'PATCH', body: { timezone } }
  );
}
