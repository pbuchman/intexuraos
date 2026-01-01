import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';

export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
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
  return {
    async getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>> {
      const url = `${config.baseUrl}/internal/users/${userId}/llm-keys`;

      try {
        const response = await fetch(url, {
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });

        if (!response.ok) {
          // Try to get error details from response body
          let errorDetails = '';
          try {
            const body = await response.text();
            errorDetails = body.length > 0 ? `: ${body.substring(0, 200)}` : '';
          } catch {
            // Ignore body read errors
          }

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

        return ok(result);
      } catch (error) {
        return err({
          code: 'NETWORK_ERROR',
          message: getErrorMessage(error),
        });
      }
    },
  };
}
