/**
 * Gemini adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 * Usage logging is handled by the client (packages/infra-gemini).
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import type { ModelPricing } from '@intexuraos/llm-contract';
import {
  buildSynthesisPrompt,
  titlePrompt,
  labelPrompt,
  type SynthesisContext,
} from '@intexuraos/llm-common';
import type { Result } from '@intexuraos/common-core';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
  LlmSynthesisResult,
  TitleGenerateResult,
  LabelGenerateResult,
} from '../../domain/research/index.js';

export class GeminiAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GeminiClient;

  constructor(apiKey: string, model: string, userId: string, pricing: ModelPricing) {
    this.client = createGeminiClient({ apiKey, model, userId, pricing });
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
  ): Promise<Result<LlmSynthesisResult, LlmError>> {
    const synthesisPrompt =
      synthesisContext !== undefined
        ? buildSynthesisPrompt(originalPrompt, reports, synthesisContext, additionalSources)
        : buildSynthesisPrompt(originalPrompt, reports, additionalSources);
    const result = await this.client.generate(synthesisPrompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }
    const { usage } = result.value;
    return {
      ok: true,
      value: {
        content: result.value.content,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }

  async generateTitle(prompt: string): Promise<Result<TitleGenerateResult, LlmError>> {
    const builtPrompt = titlePrompt.build(
      { content: prompt },
      { wordRange: { min: 5, max: 8 }, includeExamples: true }
    );
    const result = await this.client.generate(builtPrompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }
    const { usage } = result.value;
    return {
      ok: true,
      value: {
        title: result.value.content.trim(),
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }

  async generateContextLabel(content: string): Promise<Result<LabelGenerateResult, LlmError>> {
    const builtPrompt = labelPrompt.build({ content }, { contentPreviewLimit: 2000 });
    const result = await this.client.generate(builtPrompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }
    const { usage } = result.value;
    return {
      ok: true,
      value: {
        label: result.value.content.trim(),
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
