import type { Result } from '@intexuraos/common-core';
import { ok, err, getErrorMessage } from '@intexuraos/common-core';
import type { Action } from '../../domain/models/action.js';
import pino from 'pino';
import type { Logger } from 'pino';

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'actionsAgentClient',
});

export interface ActionsAgentClientConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger;
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
  const logger = config.logger ?? defaultLogger;

  return {
    async createAction(params: CreateActionParams): Promise<Result<Action>> {
      const endpoint = `${config.baseUrl}/internal/actions`;

      logger.info(
        {
          userId: params.userId,
          commandId: params.commandId,
          actionType: params.type,
          title: params.title,
        },
        'Creating action via actions-agent'
      );

      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-auth': config.internalAuthToken,
          },
          body: JSON.stringify(params),
        });
      } catch (error) {
        logger.error(
          {
            userId: params.userId,
            commandId: params.commandId,
            error: getErrorMessage(error),
          },
          'Failed to call actions-agent'
        );
        return err(
          error instanceof Error ? error : new Error(`Failed to create action: ${String(error)}`)
        );
      }

      if (!response.ok) {
        const text = await response.text();
        logger.error(
          {
            userId: params.userId,
            commandId: params.commandId,
            status: response.status,
            statusText: response.statusText,
            body: text.substring(0, 500),
          },
          'actions-agent returned error'
        );
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
        logger.error(
          {
            userId: params.userId,
            commandId: params.commandId,
          },
          'actions-agent returned success=false'
        );
        return err(new Error('Failed to create action: response.success is false'));
      }

      logger.info(
        {
          userId: params.userId,
          commandId: params.commandId,
          actionId: body.data.id,
        },
        'Action created via actions-agent'
      );

      return ok(body.data);
    },
  };
}
