/**
 * Claude adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 * Usage logging is handled by the client (packages/infra-claude).
 */

import { type ClaudeClient, createClaudeClient } from '@intexuraos/infra-claude';
import { buildSynthesisPrompt, type Result, type SynthesisContext } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
} from '../../domain/research/index.js';

export class ClaudeAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: ClaudeClient;

  constructor(apiKey: string, model: string, userId: string) {
    this.client = createClaudeClient({ apiKey, model, userId });
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);
    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }
    return result;
  }

  async synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    additionalSources?: { content: string; label?: string }[],
    synthesisContext?: SynthesisContext
  ): Promise<Result<string, LlmError>> {
    const synthesisPrompt =
      synthesisContext !== undefined
        ? buildSynthesisPrompt(originalPrompt, reports, synthesisContext, additionalSources)
        : buildSynthesisPrompt(originalPrompt, reports, additionalSources);
    const result = await this.client.generate(synthesisPrompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }
    return { ok: true, value: result.value.content };
  }

  async generateTitle(prompt: string): Promise<Result<string, LlmError>> {
    const titlePrompt = `Generate a short, concise title for this research prompt.

CRITICAL REQUIREMENTS:
- Title must be 5-8 words maximum
- Title must be in the SAME LANGUAGE as the prompt (Polish prompt → Polish title, English prompt → English title)
- Return ONLY the title - no explanations, no options, no word counts

Research prompt:
${prompt}

Generate title:`;
    const result = await this.client.generate(titlePrompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }
    return { ok: true, value: result.value.content.trim() };
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
