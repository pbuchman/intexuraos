/**
 * LLM Provider types for API key management.
 */
export type LlmProvider = 'google' | 'openai' | 'anthropic';

/**
 * Response from GET /users/:uid/settings/llm-keys
 * Contains masked API key values (e.g., "sk-...4f2a") or null if not configured.
 */
export interface LlmKeysResponse {
  google: string | null;
  openai: string | null;
  anthropic: string | null;
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
