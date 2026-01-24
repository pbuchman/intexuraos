/**
 * GLM adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 * Usage logging is handled by the client (packages/infra-glm).
 */

import { createGlmClient, type GlmClient } from '@intexuraos/infra-glm';
import type { Logger, Result } from '@intexuraos/common-core';
import type { ModelPricing } from '@intexuraos/llm-contract';
import { buildSynthesisPrompt, titlePrompt, type SynthesisContext } from '@intexuraos/llm-prompts';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
  LlmSynthesisResult,
  TitleGenerateResult,
} from '../../domain/research/index.js';

export class GlmAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GlmClient;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    pricing: ModelPricing,
    logger: Logger
  ) {
    this.client = createGlmClient({ apiKey, model, userId, pricing, logger });
    this.model = model;
    this.logger = logger;
  }

  async research(prompt: string): Promise<Result<LlmResearchResult, LlmError>> {
    this.logger.info({ model: this.model, promptLength: prompt.length }, 'GLM research started');
    const result = await this.client.research(prompt);
    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'GLM research failed'
      );
      return { ok: false, error };
    }
    this.logger.info(
      { model: this.model, usage: result.value.usage },
      'GLM research completed'
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
      'GLM synthesis started'
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
        'GLM synthesis failed'
      );
      return { ok: false, error };
    }
    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'GLM synthesis completed');
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
    this.logger.info({ model: this.model }, 'GLM title generation started');
    const builtPrompt = titlePrompt.build(
      { content: prompt },
      { wordRange: { min: 5, max: 8 } }
    );
    const result = await this.client.generate(builtPrompt);

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'GLM title generation failed'
      );
      return { ok: false, error };
    }
    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'GLM title generation completed');
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
  const validCodes = [
    'API_ERROR',
    'TIMEOUT',
    'INVALID_KEY',
    'RATE_LIMITED',
    'OVERLOADED',
    'CONTEXT_LENGTH',
    'CONTENT_FILTERED',
  ] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
