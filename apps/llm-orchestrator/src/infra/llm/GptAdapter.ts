/**
 * GPT adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 */

import { createGptClient, type GptClient } from '@intexuraos/infra-gpt';
import { buildSynthesisPrompt, type Result, type SynthesisContext } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
} from '../../domain/research/index.js';
import type { LlmUsageTracker } from '../../domain/research/services/index.js';

export class GptAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GptClient;
  private readonly model: string;
  private readonly tracker: LlmUsageTracker | undefined;

  constructor(apiKey: string, model: string, tracker?: LlmUsageTracker) {
    this.client = createGptClient({ apiKey, model });
    this.model = model;
    this.tracker = tracker;
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    const result = await this.client.research(prompt);

    if (!result.ok) {
      this.tracker?.track({
        provider: 'openai',
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
      provider: 'openai',
      model: this.model,
      callType: 'research',
      success: true,
      inputTokens: result.value.usage?.inputTokens ?? 0,
      outputTokens: result.value.usage?.outputTokens ?? 0,
    });

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
      this.tracker?.track({
        provider: 'openai',
        model: this.model,
        callType: 'synthesis',
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
      provider: 'openai',
      model: this.model,
      callType: 'synthesis',
      success: true,
      inputTokens: 0,
      outputTokens: 0,
    });

    return result;
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
      this.tracker?.track({
        provider: 'openai',
        model: this.model,
        callType: 'title',
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
      provider: 'openai',
      model: this.model,
      callType: 'title',
      success: true,
      inputTokens: 0,
      outputTokens: 0,
    });

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
