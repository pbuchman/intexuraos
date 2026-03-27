import { config } from '@/config';
import { apiRequest } from './apiClient.js';

export interface PatchTimezoneResponse {
  timezone: string;
}

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
