import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { NotionConnectResponse, NotionStatus } from '@/types';

export async function getNotionStatus(accessToken: string): Promise<NotionStatus> {
  return await apiRequest<NotionStatus>(config.notionServiceUrl, '/status', accessToken);
}

export interface NotionConnectRequest {
  notionToken: string;
}

export async function connectNotion(
  accessToken: string,
  request: NotionConnectRequest
): Promise<NotionConnectResponse> {
  return await apiRequest<NotionConnectResponse>(
    config.notionServiceUrl,
    '/connect',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function disconnectNotion(accessToken: string): Promise<void> {
  await apiRequest<{ disconnected: boolean }>(
    config.notionServiceUrl,
    '/disconnect',
    accessToken,
    { method: 'DELETE' }
  );
}
