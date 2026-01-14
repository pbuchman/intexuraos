/**
 * HTTP client for user-service internal API.
 * Provides access to user API keys and WhatsApp phone numbers.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import type { LlmProvider } from '@intexuraos/llm-contract';

export type { LlmProvider };

/**
 * Configuration for the user service client.
 */
export interface UserServiceConfig {
  baseUrl: string;
  internalAuthToken: string;
}

/**
 * Decrypted API keys returned from user-service.
 */
export interface DecryptedApiKeys {
  google?: string;
  openai?: string;
  anthropic?: string;
  perplexity?: string;
<<<<<<< HEAD
  zhipu?: string;
=======
  zai?: string;
>>>>>>> origin/development
}

/**
 * Error from user service operations.
 */
export interface UserServiceError {
  code: 'NETWORK_ERROR' | 'API_ERROR';
  message: string;
}

/**
 * Client interface for user-service internal API.
 */
export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>>;
  reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void>;
}

/**
 * Create a user service client with the given configuration.
 */
export function createUserServiceClient(config: UserServiceConfig): UserServiceClient {
  return {
    async getApiKeys(userId: string): Promise<Result<DecryptedApiKeys, UserServiceError>> {
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
          openai?: string | null;
          anthropic?: string | null;
          perplexity?: string | null;
        };

        // Convert null values to undefined (null is used by JSON to distinguish from missing)
        const result: DecryptedApiKeys = {};
        if (data.google !== null && data.google !== undefined) {
          result.google = data.google;
        }
        if (data.openai !== null && data.openai !== undefined) {
          result.openai = data.openai;
        }
        if (data.anthropic !== null && data.anthropic !== undefined) {
          result.anthropic = data.anthropic;
        }
        if (data.perplexity !== null && data.perplexity !== undefined) {
          result.perplexity = data.perplexity;
        }

        return ok(result);
      } catch (error) {
        const message = getErrorMessage(error);
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },

    async reportLlmSuccess(userId: string, provider: LlmProvider): Promise<void> {
      try {
        await fetch(`${config.baseUrl}/internal/users/${userId}/llm-keys/${provider}/last-used`, {
          method: 'POST',
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });
      } catch {
        /* Best effort - don't block on failure */
      }
    },
  };
}
