import { config } from '@/config';
import { apiRequest } from './apiClient.js';
import type { LlmKeysResponse, LlmProvider, SetLlmKeyRequest, SetLlmKeyResponse, } from './llmKeysApi.types.js';

/**
 * Get user's LLM API keys (masked values).
 */
export async function getLlmKeys(accessToken: string, userId: string): Promise<LlmKeysResponse> {
  return await apiRequest<LlmKeysResponse>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys`,
    accessToken
  );
}

/**
 * Set or update an LLM API key.
 */
export async function setLlmKey(
  accessToken: string,
  userId: string,
  request: SetLlmKeyRequest
): Promise<SetLlmKeyResponse> {
  return await apiRequest<SetLlmKeyResponse>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys`,
    accessToken,
    {
      method: 'PATCH',
      body: request,
    }
  );
}

/**
 * Delete an LLM API key.
 */
export async function deleteLlmKey(
  accessToken: string,
  userId: string,
  provider: LlmProvider
): Promise<void> {
  await apiRequest<{ deleted: boolean }>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys/${provider}`,
    accessToken,
    { method: 'DELETE' }
  );
}

/**
 * Test an LLM API key with a sample prompt.
 */
export async function testLlmKey(
  accessToken: string,
  userId: string,
  provider: LlmProvider
): Promise<{ response: string; testedAt: string }> {
  return await apiRequest<{ response: string; testedAt: string }>(
    config.authServiceUrl,
    `/users/${userId}/settings/llm-keys/${provider}/test`,
    accessToken,
    { method: 'POST' }
  );
}

export type {
  LlmProvider,
  LlmKeysResponse,
  LlmTestResult,
  SetLlmKeyRequest,
  SetLlmKeyResponse,
} from './llmKeysApi.types.js';
