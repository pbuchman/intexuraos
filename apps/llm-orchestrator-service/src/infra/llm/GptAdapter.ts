/**
 * GPT adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 */

import { createGptClient, type GptClient } from '@intexuraos/infra-gpt';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmResearchProvider,
  LlmSynthesisProvider,
  LlmResearchResult,
  LlmError,
} from '../../domain/research/index.js';

export class GptAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GptClient;

  constructor(apiKey: string) {
    this.client = createGptClient({ apiKey });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (!result.ok) {
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    return result;
  }

  async synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[]
  ): Promise<Result<string, LlmError>> {
    const result = await this.client.synthesize(originalPrompt, reports);

    if (!result.ok) {
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    return result;
  }

  async generateTitle(prompt: string): Promise<Result<string, LlmError>> {
    const result = await this.client.generateTitle(prompt);

    if (!result.ok) {
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
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
