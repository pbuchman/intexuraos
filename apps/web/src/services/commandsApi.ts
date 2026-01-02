import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  Action,
  ActionsResponse,
  Command,
  CommandSourceType,
  CommandsResponse,
} from '@/types';

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

  return await apiRequest<ActionsResponse>(config.actionsAgentUrl, path, accessToken);
}

export async function updateActionStatus(
  accessToken: string,
  actionId: string,
  status: 'processing' | 'rejected'
): Promise<Action> {
  const response = await apiRequest<{ action: Action }>(
    config.actionsAgentUrl,
    `/router/actions/${actionId}`,
    accessToken,
    {
      method: 'PATCH',
      body: { status },
    }
  );
  return response.action;
}

export async function deleteAction(accessToken: string, actionId: string): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.actionsAgentUrl,
    `/router/actions/${actionId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function deleteCommand(accessToken: string, commandId: string): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.commandsRouterServiceUrl,
    `/router/commands/${commandId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function archiveCommand(accessToken: string, commandId: string): Promise<Command> {
  const response = await apiRequest<{ command: Command }>(
    config.commandsRouterServiceUrl,
    `/router/commands/${commandId}`,
    accessToken,
    {
      method: 'PATCH',
      body: { status: 'archived' },
    }
  );
  return response.command;
}

// 💰 CostGuard: Batch endpoint prevents N+1 API calls
// Fetches up to 50 actions in single request instead of 50 individual requests
export async function batchGetActions(accessToken: string, actionIds: string[]): Promise<Action[]> {
  if (actionIds.length === 0) {
    return [];
  }

  const response = await apiRequest<{ actions: Action[] }>(
    config.actionsAgentUrl,
    '/router/actions/batch',
    accessToken,
    {
      method: 'POST',
      body: { actionIds },
    }
  );
  return response.actions;
}

export async function createCommand(
  accessToken: string,
  params: { text: string; source: CommandSourceType }
): Promise<Command> {
  const response = await apiRequest<{ command: Command }>(
    config.commandsRouterServiceUrl,
    '/router/commands',
    accessToken,
    {
      method: 'POST',
      body: params,
    }
  );
  return response.command;
}
