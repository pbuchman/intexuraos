import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { UserInfo } from '@/types';

export async function getUserInfo(accessToken: string): Promise<UserInfo> {
  return await apiRequest<UserInfo>(config.authServiceUrl, '/v1/auth/me', accessToken);
}
