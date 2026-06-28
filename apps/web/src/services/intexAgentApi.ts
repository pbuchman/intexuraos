import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';

export interface IntexAgentPreferencesResponse {
  instructions: string;
  externalSave: IntexAgentExternalSaveConfig;
  updatedAt: string | null;
}

export interface IntexAgentExternalSaveConfig {
  enabled: boolean;
  endpointUrl: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
  source: string;
}

export interface SaveIntexAgentPreferencesRequest {
  instructions: string;
  externalSave: IntexAgentExternalSaveConfig;
}

export interface IntexAgentExternalSaveTestResponse {
  status: 'success' | 'failure';
  message: string;
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
  request: SaveIntexAgentPreferencesRequest
): Promise<IntexAgentPreferencesResponse> {
  return await apiRequest<IntexAgentPreferencesResponse>(
    config.intexAgentUrl,
    '/preferences',
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify(request),
    }
  );
}

export async function testIntexAgentExternalSave(
  accessToken: string,
  externalSave: IntexAgentExternalSaveConfig
): Promise<IntexAgentExternalSaveTestResponse> {
  return await apiRequest<IntexAgentExternalSaveTestResponse>(
    config.intexAgentUrl,
    '/preferences/external-save/test',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({ externalSave }),
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
