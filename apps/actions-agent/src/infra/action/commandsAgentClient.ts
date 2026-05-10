import type { Result } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../../domain/ports/actionServiceClient.js';
import type { Action } from '../../domain/models/action.js';
import { createAppLogger } from '@intexuraos/infra-sentry';
import { createActionsAgentServiceClient } from '@intexuraos/internal-clients';

export interface CommandsAgentClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

const logger = createAppLogger({ name: 'commandsAgentClient' });

export function createCommandsAgentClient(
  config: CommandsAgentClientConfig
): ActionServiceClient {
  const client = createActionsAgentServiceClient({
    ...config,
    logger,
  });

  return {
    async getAction(actionId: string): Promise<Result<Action | null>> {
      return await client.getAction<Action>(actionId);
    },

    async updateActionStatus(actionId: string, status: string): Promise<Result<void>> {
      return await client.updateActionStatus(actionId, status);
    },

    async updateAction(
      actionId: string,
      update: { status: string; payload?: Record<string, unknown> }
    ): Promise<Result<void>> {
      return await client.updateAction(actionId, update);
    },
  };
}
