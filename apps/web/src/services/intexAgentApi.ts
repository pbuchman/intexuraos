import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';

export interface IntexAgentPreferencesResponse {
  instructions: string;
  updatedAt: string | null;
}

export async function listIntexAgentSessions(accessToken: string): Promise<IntexAgentSession[]> {
  return await apiRequest<IntexAgentSession[]>(config.intexAgentUrl, '/sessions', accessToken);
}

export async function getIntexAgentSession(
  accessToken: string,
  sessionId: string
): Promise<IntexAgentSession> {
  return await apiRequest<IntexAgentSession>(
    config.intexAgentUrl,
    `/sessions/${encodeURIComponent(sessionId)}`,
    accessToken
  );
}

export async function listIntexAgentSessionEvents(
  accessToken: string,
  sessionId: string
): Promise<IntexAgentSessionEvent[]> {
  return await apiRequest<IntexAgentSessionEvent[]>(
    config.intexAgentUrl,
    `/sessions/${encodeURIComponent(sessionId)}/events`,
    accessToken
  );
}

export async function getIntexAgentPreferences(
  accessToken: string
): Promise<IntexAgentPreferencesResponse> {
  return await apiRequest<IntexAgentPreferencesResponse>(
    config.intexAgentUrl,
    '/preferences',
    accessToken
  );
}

export async function saveIntexAgentPreferences(
  accessToken: string,
  instructions: string
): Promise<IntexAgentPreferencesResponse> {
  return await apiRequest<IntexAgentPreferencesResponse>(
    config.intexAgentUrl,
    '/preferences',
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ instructions }),
    }
  );
}

export async function clearIntexAgentPreferences(
  accessToken: string
): Promise<IntexAgentPreferencesResponse> {
  return await apiRequest<IntexAgentPreferencesResponse>(
    config.intexAgentUrl,
    '/preferences',
    accessToken,
    {
      method: 'DELETE',
    }
  );
}
