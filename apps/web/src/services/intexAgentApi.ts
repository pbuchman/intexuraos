import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { IntexAgentSession, IntexAgentSessionEvent } from '@/types';

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
