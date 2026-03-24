/**
 * OpenRouter adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 *
 * OpenRouter provides access to frontier models from multiple providers through
 * a unified API. Web search is enabled via :online suffix (powered by Exa).
 *
 * Usage logging is handled by the client (packages/infra-openrouter).
 */

import { createOpenRouterClient, type OpenRouterClient } from '@intexuraos/infra-openrouter';
import type { Logger, Result } from '@intexuraos/common-core';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { buildResearchPrompt, buildSynthesisPrompt, titlePrompt, type ResearchContext, type SynthesisContext } from '@intexuraos/llm-prompts';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
  LlmSynthesisResult,
  TitleGenerateResult,
} from '../../domain/research/index.js';

export class OpenRouterAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: OpenRouterClient;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    pricing: ModelPricing,
    logger: Logger
  ) {
    this.client = createOpenRouterClient({
      apiKey,
      model,
      userId,
      pricing,
      logger,
    });
    this.model = model;
    this.logger = logger;
  }

  async research(prompt: string, ctx?: ResearchContext): Promise<Result<LlmResearchResult, LlmError>> {
    const builtPrompt = buildResearchPrompt(prompt, ctx);
    this.logger.info({ model: this.model, promptLength: builtPrompt.length }, 'OpenRouter research started');
    const result = await this.client.research(builtPrompt);
    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'OpenRouter research failed'
      );
      return { ok: false, error };
    }
    this.logger.info(
      { model: this.model, usage: result.value.usage },
      'OpenRouter research completed'
    );
    return result;
  }

  async synthesize(
    originalPrompt: string,
    reports: { model: string; content: string }[],
    additionalSources?: { content: string; label?: string }[],
    synthesisContext?: SynthesisContext
  ): Promise<Result<LlmSynthesisResult, LlmError>> {
    this.logger.info(
      { model: this.model, reportCount: reports.length, sourceCount: additionalSources?.length ?? 0 },
      'OpenRouter synthesis started'
    );
    const synthesisPrompt =
      synthesisContext !== undefined
        ? buildSynthesisPrompt(originalPrompt, reports, synthesisContext, additionalSources)
        : buildSynthesisPrompt(originalPrompt, reports, additionalSources);
    const result = await this.client.generate(synthesisPrompt);

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'OpenRouter synthesis failed'
      );
      return { ok: false, error };
    }
    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'OpenRouter synthesis completed');
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
    this.logger.info({ model: this.model }, 'OpenRouter title generation started');
    const builtPrompt = titlePrompt.build(
      { content: prompt },
      { wordRange: { min: 5, max: 8 } }
    );
    const result = await this.client.generate(builtPrompt);

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'OpenRouter title generation failed'
      );
      return { ok: false, error };
    }
    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'OpenRouter title generation completed');
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
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED', 'OVERLOADED'] as const;
  /* v8 ignore start -- ts-type: error code type narrowing for LlmError union @preserve */
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';
  /* v8 ignore stop @preserve */

  return { code, message: error.message };
}