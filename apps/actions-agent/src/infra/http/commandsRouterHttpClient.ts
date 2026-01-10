import { getErrorMessage } from '@intexuraos/common-core';
import type {
  CommandsRouterClient,
  CommandWithText,
} from '../../domain/ports/commandsRouterClient.js';
import pino from 'pino';

export interface CommandsRouterHttpClientConfig {
  baseUrl: string;
  internalAuthToken: string;
}

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'commandsRouterHttpClient',
});

interface GetCommandResponse {
  success: boolean;
  data?: {
    command: {
      id: string;
      text: string;
      sourceType: string;
    };
  };
}

export function createCommandsRouterHttpClient(
  config: CommandsRouterHttpClientConfig
): CommandsRouterClient {
  return {
    async getCommand(commandId: string): Promise<CommandWithText | null> {
      const url = `${config.baseUrl}/internal/router/commands/${commandId}`;

      logger.info({ commandId, url }, 'Fetching command from commands-router');

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Auth': config.internalAuthToken,
          },
        });
      } catch (error) {
        logger.error({ commandId, error: getErrorMessage(error) }, 'Failed to fetch command');
        throw error;
      }

      if (response.status === 404) {
        logger.info({ commandId }, 'Command not found');
        return null;
      }

      if (!response.ok) {
        logger.error(
          { commandId, httpStatus: response.status, statusText: response.statusText },
          'Failed to fetch command - HTTP error'
        );
        throw new Error(`HTTP ${String(response.status)}: Failed to fetch command`);
      }

      const body = (await response.json()) as GetCommandResponse;
      if (!body.success || body.data === undefined) {
        logger.error({ commandId, body }, 'Invalid response from commands-router');
        throw new Error('Invalid response from commands-router');
      }

      logger.info({ commandId }, 'Successfully fetched command');

      return {
        id: body.data.command.id,
        text: body.data.command.text,
        sourceType: body.data.command.sourceType,
      };
    },
  };
}
