/**
 * Claude adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 */

import { type ClaudeClient, createClaudeClient } from '@intexuraos/infra-claude';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
} from '../../domain/research/index.js';

export class ClaudeAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: ClaudeClient;

  constructor(apiKey: string, researchModel?: string) {
    const config: Parameters<typeof createClaudeClient>[0] = { apiKey };
    if (researchModel !== undefined) {
      config.researchModel = researchModel;
    }
    this.client = createClaudeClient(config);
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
