import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import pino from 'pino';
import type { Logger } from 'pino';

const defaultLogger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  name: 'userServiceClient',
});

export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
  logger?: Logger;
}

export interface UserApiKeys {
  google?: string;
}

export interface UserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>>;
}

export function createUserServiceClient(config: UserServiceConfig): UserServiceClient {
  const logger = config.logger ?? defaultLogger;

  return {
    async getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>> {
      const url = `${config.baseUrl}/internal/users/${userId}/llm-keys`;

      logger.info({ userId }, 'Fetching user API keys');

      let response: Response;
      try {
        response = await fetch(url, {
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });
      } catch (error) {
        logger.error(
          {
            userId,
            error: getErrorMessage(error),
          },
          'Failed to fetch API keys'
        );
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }

      if (!response.ok) {
        let errorDetails = '';
        try {
          const body = await response.text();
          errorDetails = body.length > 0 ? `: ${body.substring(0, 200)}` : '';
        } catch {
          /* Body read errors are not worth logging separately */
        }

        logger.error(
          {
            userId,
            status: response.status,
            statusText: response.statusText,
          },
          'User service returned error'
        );

        return err({
          code: 'API_ERROR',
          message: `HTTP ${String(response.status)}${errorDetails}`,
        });
      }

      const data = (await response.json()) as {
        google?: string | null;
      };

      const result: UserApiKeys = {};
      if (data.google !== null && data.google !== undefined) {
        result.google = data.google;
      }

      logger.info(
        {
          userId,
          hasGoogleKey: result.google !== undefined,
        },
        'API keys fetched'
      );

      return ok(result);
    },
  };
}
