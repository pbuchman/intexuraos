import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { UserInfo, UserSettings, NotificationFilter } from '@/types';

export async function getUserInfo(accessToken: string): Promise<UserInfo> {
  return await apiRequest<UserInfo>(config.authServiceUrl, '/auth/me', accessToken);
}

export async function getUserSettings(accessToken: string, userId: string): Promise<UserSettings> {
  return await apiRequest<UserSettings>(
    config.authServiceUrl,
    `/users/${encodeURIComponent(userId)}/settings`,
    accessToken
  );
}

export async function updateUserSettings(
  accessToken: string,
  userId: string,
  notifications: { filters: NotificationFilter[] }
): Promise<UserSettings> {
  return await apiRequest<UserSettings>(
    config.authServiceUrl,
    `/users/${encodeURIComponent(userId)}/settings`,
    accessToken,
    {
      method: 'PATCH',
      body: { notifications },
    }
  );
}
