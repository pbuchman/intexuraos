import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { ActionServiceClient } from '../../domain/ports/actionServiceClient.js';
import type { Action } from '../../domain/models/action.js';
import pino from 'pino';

export interface CommandsRouterClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'commandsRouterClient',
});

export function createCommandsRouterClient(
  config: CommandsRouterClientConfig
): ActionServiceClient {
  return {
    async getAction(actionId: string): Promise<Result<Action | null>> {
      try {
        logger.info(
          {
            actionId,
            endpoint: `${config.baseUrl}/internal/actions/${actionId}`,
          },
          'Calling GET /internal/actions/:actionId to get action'
        );

        const response = await fetch(`${config.baseUrl}/internal/actions/${actionId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            logger.info({ actionId }, 'Action not found (404)');
            return ok(null);
          }
          logger.error(
            {
              actionId,
              httpStatus: response.status,
              statusText: response.statusText,
            },
            'Failed to get action - HTTP error'
          );
          return err(new Error(`HTTP ${String(response.status)}: Failed to get action`));
        }

        const action = (await response.json()) as Action;
        logger.info({ actionId, status: action.status }, 'Successfully got action');

        return ok(action);
      } catch (error) {
        logger.error(
          {
            actionId,
            error: getErrorMessage(error),
          },
          'Failed to get action - network error'
        );
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },

    async updateActionStatus(actionId: string, status: string): Promise<Result<void>> {
      try {
        logger.info(
          {
            actionId,
            status,
            endpoint: `${config.baseUrl}/internal/actions/${actionId}`,
          },
          'Calling PATCH /internal/actions/:actionId to update status'
        );

        const response = await fetch(`${config.baseUrl}/internal/actions/${actionId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify({ status }),
        });

        if (!response.ok) {
          logger.error(
            {
              actionId,
              status,
              httpStatus: response.status,
              statusText: response.statusText,
            },
            'Failed to update action status - HTTP error'
          );
          return err(new Error(`HTTP ${String(response.status)}: Failed to update action status`));
        }

        logger.info({ actionId, status }, 'Successfully updated action status');

        return ok(undefined);
      } catch (error) {
        logger.error(
          {
            actionId,
            status,
            error: getErrorMessage(error),
          },
          'Failed to update action status - network error'
        );
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },

    async updateAction(
      actionId: string,
      update: { status: string; payload?: Record<string, unknown> }
    ): Promise<Result<void>> {
      try {
        logger.info(
          {
            actionId,
            status: update.status,
            hasPayload: update.payload !== undefined,
            endpoint: `${config.baseUrl}/internal/actions/${actionId}`,
          },
          'Calling PATCH /internal/actions/:actionId to update action'
        );

        const response = await fetch(`${config.baseUrl}/internal/actions/${actionId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
          body: JSON.stringify(update),
        });

        if (!response.ok) {
          logger.error(
            {
              actionId,
              status: update.status,
              httpStatus: response.status,
              statusText: response.statusText,
            },
            'Failed to update action - HTTP error'
          );
          return err(new Error(`HTTP ${String(response.status)}: Failed to update action`));
        }

        logger.info({ actionId, status: update.status }, 'Successfully updated action');

        return ok(undefined);
      } catch (error) {
        logger.error(
          {
            actionId,
            status: update.status,
            error: getErrorMessage(error),
          },
          'Failed to update action - network error'
        );
        return err(new Error(`Network error: ${getErrorMessage(error)}`));
      }
    },
  };
}
