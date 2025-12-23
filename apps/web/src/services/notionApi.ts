import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { NotionStatus, NotionConnectResponse } from '@/types';

export async function getNotionStatus(accessToken: string): Promise<NotionStatus> {
  return await apiRequest<NotionStatus>(
    config.promptVaultServiceUrl,
    '/v1/integrations/notion/status',
    accessToken
  );
}

export interface NotionConnectRequest {
  notionToken: string;
  promptVaultPageId: string;
}

export async function connectNotion(
  accessToken: string,
  request: NotionConnectRequest
): Promise<NotionConnectResponse> {
  return await apiRequest<NotionConnectResponse>(
    config.promptVaultServiceUrl,
    '/v1/integrations/notion/connect',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}

export async function disconnectNotion(accessToken: string): Promise<void> {
  await apiRequest<{ disconnected: boolean }>(
    config.promptVaultServiceUrl,
    '/v1/integrations/notion/disconnect',
    accessToken,
    { method: 'DELETE' }
  );
}
