import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { UserInfo, UserSettings, NotificationFilter, LLMProvider } from '@/types';

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

interface UpdateUserSettingsRequest {
  notifications?: { filters: NotificationFilter[] };
  apiKeys?: Record<LLMProvider, string>;
}

export async function updateUserSettings(
  accessToken: string,
  userId: string,
  updates: UpdateUserSettingsRequest
): Promise<UserSettings> {
  return await apiRequest<UserSettings>(
    config.authServiceUrl,
    `/users/${encodeURIComponent(userId)}/settings`,
    accessToken,
    {
      method: 'PATCH',
      body: updates,
    }
  );
}
