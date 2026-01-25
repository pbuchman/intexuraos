// LLM user service client - from shared package
export {
  createUserServiceClient,
  type UserServiceClient as LlmUserServiceClient,
  type UserServiceConfig,
  type UserServiceError,
  type DecryptedApiKeys,
} from '@intexuraos/internal-clients/user-service';

// Calendar OAuth user service client - local implementation
export { UserServiceClientImpl } from './userServiceClient.js';
export type { UserServiceClient, OAuthTokenResult } from '../../domain/ports.js';
