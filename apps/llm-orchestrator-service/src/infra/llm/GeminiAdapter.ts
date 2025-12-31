/**
 * Gemini adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
} from '../../domain/research/index.js';

export class GeminiAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GeminiClient;

  constructor(apiKey: string) {
    this.client = createGeminiClient({ apiKey });
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
    reports: { model: string; content: string }[],
    inputContexts?: { content: string }[]
  ): Promise<Result<string, LlmError>> {
    const result = await this.client.synthesize(originalPrompt, reports, inputContexts);

    if (!result.ok) {
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    return result;
  }

  async generateTitle(prompt: string): Promise<Result<string, LlmError>> {
    const titlePrompt = `Generate a short, descriptive title (max 10 words) for this research prompt:\n\n${prompt}`;
    const result = await this.client.generate(titlePrompt);

    if (!result.ok) {
      return {
        ok: false,
        error: mapToLlmError(result.error),
      };
    }

    return { ok: true, value: result.value.trim() };
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
