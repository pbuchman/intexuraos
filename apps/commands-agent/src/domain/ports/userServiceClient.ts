import type { Result } from '@intexuraos/common-core';
import { ok, err } from '@intexuraos/common-core';
import type { LlmGenerateClient } from '@intexuraos/llm-factory';
import type {
  UserServiceClient as SharedUserServiceClient,
  DecryptedApiKeys,
  UserServiceError as SharedUserServiceError,
} from '@intexuraos/internal-clients';

// Re-export types from shared package for convenience
export type { DecryptedApiKeys };

// Create a type alias for UserServiceError
export type UserServiceError = SharedUserServiceError;

// Domain-specific UserApiKeys type (subset of DecryptedApiKeys)
export interface UserApiKeys {
  google?: string;
}

// Domain port that adapts the shared UserServiceClient
export interface UserServiceClient {
  getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>>;
  getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>>;
}

// Adapter function to convert shared client to domain port
export function adaptUserServiceClient(
  sharedClient: SharedUserServiceClient
): UserServiceClient {
  return {
    async getApiKeys(userId: string): Promise<Result<UserApiKeys, UserServiceError>> {
      const result = await sharedClient.getApiKeys(userId);
      if (!result.ok) {
        return result;
      }
      // Convert DecryptedApiKeys to UserApiKeys (only google key)
      const { google } = result.value;
      if (google === undefined || google === '') {
        return err({
          code: 'NO_API_KEY',
          message: 'No Google API key configured',
        });
      }
      return ok({ google });
    },
    async getLlmClient(userId: string): Promise<Result<LlmGenerateClient, UserServiceError>> {
      return await sharedClient.getLlmClient(userId);
    },
  };
}
