import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { GitHubConnectionStatus } from '@/types';

export interface GitHubInitiateResponse {
  authorizationUrl: string;
}

export async function initiateGitHubOAuth(accessToken: string): Promise<GitHubInitiateResponse> {
  return await apiRequest<GitHubInitiateResponse>(
    config.authServiceUrl,
    '/oauth/connections/github/initiate',
    accessToken,
    { method: 'POST' }
  );
}

export async function getGitHubConnectionStatus(accessToken: string): Promise<GitHubConnectionStatus> {
  return await apiRequest<GitHubConnectionStatus>(
    config.authServiceUrl,
    '/oauth/connections/github/status',
    accessToken
  );
}

export async function disconnectGitHub(accessToken: string): Promise<void> {
  await apiRequest<{ disconnected: boolean }>(
    config.authServiceUrl,
    '/oauth/connections/github',
    accessToken,
    { method: 'DELETE' }
  );
}
