import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { ActionsResponse, CommandsResponse } from '@/types';

export async function getCommands(
  accessToken: string,
  options?: { limit?: number; cursor?: string }
): Promise<CommandsResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  const queryString = params.toString();
  const path = queryString !== '' ? `/router/commands?${queryString}` : '/router/commands';

  return await apiRequest<CommandsResponse>(config.commandsRouterServiceUrl, path, accessToken);
}

export async function getActions(
  accessToken: string,
  options?: { limit?: number; cursor?: string }
): Promise<ActionsResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  const queryString = params.toString();
  const path = queryString !== '' ? `/router/actions?${queryString}` : '/router/actions';

  return await apiRequest<ActionsResponse>(config.commandsRouterServiceUrl, path, accessToken);
}
