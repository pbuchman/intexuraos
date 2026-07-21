import type { IntexAgentModel, LlmProvider } from '@intexuraos/llm-contract';
/**
 * LLM Provider types for API key management.
 */
export type { LlmProvider };

export type IntexAgentModelSelectorOption =
  | { id: 'or:deepseek/deepseek-v4-flash'; label: 'DeepSeek V4 Flash' }
  | { id: 'or:minimax/minimax-m3'; label: 'MiniMax M3' }
  | { id: 'or:google/gemini-3-flash-preview'; label: 'Gemini 3 Flash Preview' };

export type IntexAgentModelSelectorV1 =
  | {
      status: 'available';
      explicitModel: IntexAgentModel | null;
      effectiveModel: IntexAgentModel;
      source: 'explicit' | 'default_absent';
      revision: number;
      options: readonly [
        Extract<IntexAgentModelSelectorOption, { id: 'or:deepseek/deepseek-v4-flash' }>,
        Extract<IntexAgentModelSelectorOption, { id: 'or:minimax/minimax-m3' }>,
        Extract<IntexAgentModelSelectorOption, { id: 'or:google/gemini-3-flash-preview' }>,
      ];
    }
  | { status: 'unavailable' };

export interface IntexAgentModelPatchRequest {
  intexAgentModel: IntexAgentModel | null;
  expectedRevision: number;
}

export interface IntexAgentModelPatchResponse {
  explicitModel: IntexAgentModel | null;
  effectiveModel: IntexAgentModel;
  source: 'explicit' | 'default_absent';
  revision: number;
}

/**
 * Test result for an LLM API key.
 */
export interface LlmTestResult {
  status: 'success' | 'failure';
  message: string; // LLM response (success) or user-friendly error (failure)
  testedAt: string;
}

/**
 * Response from GET /users/:uid/settings/llm-keys
 * Contains masked API key values (e.g., "sk-...4f2a") or null if not configured.
 */
export interface LlmKeysResponse {
  defaultModel: string | null;
  fallbackModel: string | null;
  google: string | null;
  openai: string | null;
  anthropic: string | null;
  perplexity: string | null;
  openrouter: string | null;
  testResults: {
    google: LlmTestResult | null;
    openai: LlmTestResult | null;
    anthropic: LlmTestResult | null;
    perplexity: LlmTestResult | null;
    openrouter: LlmTestResult | null;
  };
  intexAgentModelSelector: IntexAgentModelSelectorV1;
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
