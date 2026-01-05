/**
 * Perplexity adapter implementing LlmResearchProvider.
 * Note: Perplexity is used ONLY for research, not synthesis.
 */

import { createPerplexityClient, type PerplexityClient } from '@intexuraos/infra-perplexity';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
} from '../../domain/research/index.js';
import type { LlmUsageTracker } from '../../domain/research/services/index.js';

export class PerplexityAdapter implements LlmResearchProvider {
  private readonly client: PerplexityClient;
  private readonly model: string;
  private readonly tracker: LlmUsageTracker | undefined;

  constructor(apiKey: string, model: string, userId: string, tracker?: LlmUsageTracker) {
    this.client = createPerplexityClient({ apiKey, model, userId });
    this.model = model;
    this.tracker = tracker;
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'perplexity',
        model: this.model,
        callType: 'research',
        success: false,
        inputTokens: 0,
        outputTokens: 0,
      });
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    this.tracker?.track({
      provider: 'perplexity',
      model: this.model,
      callType: 'research',
      success: true,
      inputTokens: result.value.usage.inputTokens,
      outputTokens: result.value.usage.outputTokens,
      providerCost: result.value.usage.costUsd,
    });

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
