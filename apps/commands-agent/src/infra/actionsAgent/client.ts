import type { Result } from '@intexuraos/common-core';
import type { Action } from '../../domain/models/action.js';
import type { Logger } from 'pino';
import type {
  ActionsAgentClient,
  CreateActionParams,
} from '../../domain/ports/actionsAgentClient.js';
import {
  createActionsAgentServiceClient,
  type ActionsAgentServiceConfig,
} from '@intexuraos/internal-clients';

export type { ActionsAgentClient, CreateActionParams };

export interface ActionsAgentClientConfig extends ActionsAgentServiceConfig {
  logger: Logger;
}

export function createActionsAgentClient(config: ActionsAgentClientConfig): ActionsAgentClient {
  const client = createActionsAgentServiceClient(config);

  return {
    async createAction(params: CreateActionParams): Promise<Result<Action>> {
      return await client.createAction<Action>(params);
    },
  };
}
