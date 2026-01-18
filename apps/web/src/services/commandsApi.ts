import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type {
  Action,
  ActionsResponse,
  ActionStatus,
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
  const path = queryString !== '' ? `/commands?${queryString}` : '/commands';

  return await apiRequest<CommandsResponse>(config.commandsAgentServiceUrl, path, accessToken);
}

export async function getActions(
  accessToken: string,
  options?: { limit?: number; cursor?: string; status?: ActionStatus[] }
): Promise<ActionsResponse> {
  const params = new URLSearchParams();
  if (options?.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  if (options?.cursor !== undefined) {
    params.set('cursor', options.cursor);
  }
  if (options?.status !== undefined && options.status.length > 0) {
    params.set('status', options.status.join(','));
  }
  const queryString = params.toString();
  const path = queryString !== '' ? `/actions?${queryString}` : '/actions';

  return await apiRequest<ActionsResponse>(config.actionsAgentUrl, path, accessToken);
}

export async function updateAction(
  accessToken: string,
  actionId: string,
  updates: {
    status?: 'processing' | 'rejected' | 'archived';
    type?: Action['type'];
  }
): Promise<Action> {
  const response = await apiRequest<{ action: Action }>(
    config.actionsAgentUrl,
    `/actions/${actionId}`,
    accessToken,
    {
      method: 'PATCH',
      body: updates,
    }
  );
  return response.action;
}

export async function deleteAction(accessToken: string, actionId: string): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.actionsAgentUrl,
    `/actions/${actionId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function deleteCommand(accessToken: string, commandId: string): Promise<void> {
  await apiRequest<Record<string, never>>(
    config.commandsAgentServiceUrl,
    `/commands/${commandId}`,
    accessToken,
    { method: 'DELETE' }
  );
}

export async function archiveCommand(accessToken: string, commandId: string): Promise<Command> {
  const response = await apiRequest<{ command: Command }>(
    config.commandsAgentServiceUrl,
    `/commands/${commandId}`,
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
    '/actions/batch',
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
    config.commandsAgentServiceUrl,
    '/commands',
    accessToken,
    {
      method: 'POST',
      body: params,
    }
  );
  return response.command;
}

export async function resolveDuplicateAction(
  accessToken: string,
  actionId: string,
  choice: 'skip' | 'update'
): Promise<{ actionId: string; status: 'rejected' | 'completed'; resourceUrl?: string }> {
  const response = await apiRequest<{
    actionId: string;
    status: 'rejected' | 'completed';
    resource_url?: string;
  }>(
    config.actionsAgentUrl,
    `/actions/${actionId}/resolve-duplicate`,
    accessToken,
    {
      method: 'POST',
      body: { action: choice },
    }
  );
  return {
    actionId: response.actionId,
    status: response.status,
    ...(response.resource_url !== undefined && { resourceUrl: response.resource_url }),
  };
}
