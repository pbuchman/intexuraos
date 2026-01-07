import type { LlmProvider } from '@intexuraos/llm-contract';
/**
 * LLM Provider types for API key management.
 */
export type { LlmProvider };

/**
 * Test result for an LLM API key.
 */
export interface LlmTestResult {
  response: string;
  testedAt: string;
}

/**
 * Response from GET /users/:uid/settings/llm-keys
 * Contains masked API key values (e.g., "sk-...4f2a") or null if not configured.
 */
export interface LlmKeysResponse {
  google: string | null;
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  testResults: {
    google: LlmTestResult | null;
    openai: LlmTestResult | null;
    anthropic: LlmTestResult | null;
    perplexity: LlmTestResult | null;
  };
}

/**
 * Request body for PATCH /users/:uid/settings/llm-keys
 */
export interface SetLlmKeyRequest {
  provider: LlmProvider;
  apiKey: string;
}

/**
 * Response from PATCH /users/:uid/settings/llm-keys
 */
export interface SetLlmKeyResponse {
  provider: LlmProvider;
  masked: string;
}
