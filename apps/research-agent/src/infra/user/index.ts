/**
 * User service infrastructure adapter.
 */
export {
  createUserServiceClient,
  type UserServiceClient,
  type UserServiceConfig,
  type DecryptedApiKeys,
  type UserServiceError,
  type LlmProvider,
} from './userServiceClient.js';
export type { LlmGenerateClient, GenerateResult, LLMError } from '@intexuraos/llm-factory';
