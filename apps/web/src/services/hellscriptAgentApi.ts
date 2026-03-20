import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  HellscriptBufferSummary,
  HellscriptWorkspaceResponse,
  HellscriptImposeRequest,
  HellscriptImposeResponse,
} from '@/types';

export async function listHellscriptBuffers(
  accessToken: string
): Promise<HellscriptBufferSummary[]> {
  return await apiRequest<HellscriptBufferSummary[]>(
    config.hellscriptAgentUrl,
    '/hellscript/buffers',
    accessToken
  );
}

export async function getHellscriptWorkspace(
  accessToken: string,
  bufferId: string
): Promise<HellscriptWorkspaceResponse> {
  return await apiRequest<HellscriptWorkspaceResponse>(
    config.hellscriptAgentUrl,
    `/hellscript/buffers/${encodeURIComponent(bufferId)}`,
    accessToken
  );
}

export async function imposeOnBuffer(
  accessToken: string,
  request: HellscriptImposeRequest
): Promise<HellscriptImposeResponse> {
  return await apiRequest<HellscriptImposeResponse>(
    config.hellscriptAgentUrl,
    '/hellscript/impose',
    accessToken,
    {
      method: 'POST',
      body: request,
    }
  );
}
