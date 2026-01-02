import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { Action } from '../../domain/models/action.js';

export interface ActionsAgentClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

export interface CreateActionParams {
  userId: string;
  commandId: string;
  type: 'todo' | 'research' | 'note' | 'link' | 'calendar' | 'reminder';
  title: string;
  confidence: number;
  payload?: Record<string, unknown>;
}

export interface ActionsAgentClient {
  createAction(params: CreateActionParams): Promise<Result<Action>>;
}

export function createActionsAgentClient(config: ActionsAgentClientConfig): ActionsAgentClient {
  return {
    async createAction(params: CreateActionParams): Promise<Result<Action>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/actions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-auth': config.internalAuthToken,
          },
          body: JSON.stringify(params),
        });

        if (!response.ok) {
          const text = await response.text();
          return err(
            new Error(
              `Failed to create action: ${String(response.status)} ${response.statusText} - ${text}`
            )
          );
        }

        const body = (await response.json()) as {
          success: boolean;
          data: Action;
        };

        if (!body.success) {
          return err(new Error('Failed to create action: response.success is false'));
        }

        return ok(body.data);
      } catch (error) {
        return err(
          error instanceof Error ? error : new Error(`Failed to create action: ${String(error)}`)
        );
      }
    },
  };
}
