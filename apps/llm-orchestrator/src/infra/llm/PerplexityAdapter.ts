/**
 * Perplexity adapter implementing LlmResearchProvider.
 * Note: Perplexity is used ONLY for research, not synthesis.
 * Usage logging is handled by the client (packages/infra-perplexity).
 */

import { createPerplexityClient, type PerplexityClient } from '@intexuraos/infra-perplexity';
import type { ModelPricing } from '@intexuraos/llm-contract';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
} from '../../domain/research/index.js';

export class PerplexityAdapter implements LlmResearchProvider {
  private readonly client: PerplexityClient;

  constructor(apiKey: string, model: string, userId: string, pricing: ModelPricing) {
    this.client = createPerplexityClient({ apiKey, model, userId, pricing });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);
    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }
    return result;
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
