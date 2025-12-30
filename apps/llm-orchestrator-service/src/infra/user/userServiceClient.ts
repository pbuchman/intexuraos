/**
 * HTTP client for user-service internal API.
 * Provides access to user API keys and WhatsApp phone numbers.
 */

import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';

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
  getWhatsAppPhone(userId: string): Promise<Result<string | null, UserServiceError>>;
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

        return ok(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return err({
          code: 'NETWORK_ERROR',
          message,
        });
      }
    },

    async getWhatsAppPhone(userId: string): Promise<Result<string | null, UserServiceError>> {
      try {
        const response = await fetch(`${config.baseUrl}/internal/users/${userId}/whatsapp-phone`, {
          headers: {
            'X-Internal-Auth': config.internalAuthToken,
          },
        });

        if (!response.ok) {
          // Not found is acceptable - return null
          return ok(null);
        }

        const data = (await response.json()) as { phone?: string };
        return ok(data.phone ?? null);
      } catch {
        // Network error returns null (best effort)
        return ok(null);
      }
    },
  };
}
