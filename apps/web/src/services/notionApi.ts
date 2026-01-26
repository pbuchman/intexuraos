import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { NotionConnectResponse, NotionStatus } from '@/types';

export async function getNotionStatus(accessToken: string): Promise<NotionStatus> {
  return await apiRequest<NotionStatus>(config.notionServiceUrl, '/notion/status', accessToken);
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
    '/notion/connect',
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
    '/notion/disconnect',
    accessToken,
    { method: 'DELETE' }
  );
}
