/**
 * HTTP client for user-service internal API.
 * Provides access to user's Gemini API key.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';

/**
 * Configuration for the user service client.
 */
export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

/**
 * Error from user service operations.
 */
export interface UserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR' | 'NO_API_KEY';
  message: string;
}

/**
 * Client interface for user-service internal API.
 */
export interface UserServiceClient {
  getGeminiApiKey(userId: string): Promise<Result<string, UserServiceError>>;
}

/**
 * Create a user service client with the given configuration.
 */
export function createUserServiceClient(config: UserServiceConfig): UserServiceClient {
  return {
    async getGeminiApiKey(userId: string): Promise<Result<string, UserServiceError>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/users/${userId}/llm-keys`, {
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });

        if (!response.ok) {
          return err({
            code: 'API_ERROR',
            message: `HTTP ${String(response.status)}`,
          });
        }

        const data = (await response.json()) as {
          google?: string | null;
        };

        if (data.google === null || data.google === undefined) {
          return err({
            code: 'NO_API_KEY',
            message: 'User has not configured a Gemini API key',
          });
        }

        return ok(data.google);
      } catch (error) {
        const message = getErrorMessage(error);
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },
  };
}
