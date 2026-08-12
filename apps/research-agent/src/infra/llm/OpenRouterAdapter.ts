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
import { isOpenRouterModel, getOpenRouterRawId } from '@intexuraos/llm-contract';
import type { UsageSink } from '@intexuraos/llm-pricing';
import { labelPrompt, researchPrompt, synthesisPrompt, titlePrompt, type ResearchContext, type SynthesisContext } from '@intexuraos/llm-prompts';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
  LlmSynthesisResult,
  LabelGenerateResult,
  ResearchProviderCallOptions,
  TitleGenerateResult,
} from '../../domain/research/index.js';

export class OpenRouterAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: OpenRouterClient;
  private readonly model: string;
  private readonly logger: Logger;
  /**
   * Optional research correlation token baked at construction time.
   * Synthesis and title generation must carry `correlation.researchId` so
   * usage events are attributable to the originating research.
   */
  private readonly researchId?: string;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    logger: Logger,
    usageSink: UsageSink,
    researchId?: string
  ) {
    // Strip 'or:' prefix before passing to OpenRouter API client
    const rawModel = isOpenRouterModel(model) ? getOpenRouterRawId(model) : model;
    this.client = createOpenRouterClient({
      apiKey,
      model: rawModel,
      userId,
      logger,
      usageSink,
    });
    this.model = model;
    this.logger = logger;
    if (researchId !== undefined) {
      this.researchId = researchId;
    }
  }

  private generateOptions(promptType: string): {
    promptType: string;
    correlation?: { researchId: string };
  } {
    if (this.researchId !== undefined) {
      return { promptType, correlation: { researchId: this.researchId } };
    }
    return { promptType };
  }

  async research(
    prompt: string,
    ctx?: ResearchContext,
    options?: ResearchProviderCallOptions
  ): Promise<Result<LlmResearchResult, LlmError>> {
    const builtPrompt = researchPrompt.build({ userPrompt: prompt, ctx });
    this.logger.info({ model: this.model, promptLength: builtPrompt.length }, 'OpenRouter research started');
    // A per-call researchId takes precedence over the constructor value.
    const callResearchId = options?.researchId ?? this.researchId;
    const researchOptions = {
      promptType: options?.promptType ?? 'research-web-search',
      ...(callResearchId !== undefined && { correlation: { researchId: callResearchId } }),
    };
    const result = await this.client.research(builtPrompt, researchOptions);
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
    synthesisContext?: SynthesisContext,
    options?: { promptType?: string }
  ): Promise<Result<LlmSynthesisResult, LlmError>> {
    this.logger.info(
      { model: this.model, reportCount: reports.length, sourceCount: additionalSources?.length ?? 0 },
      'OpenRouter synthesis started'
    );
    const synthesisPromptText = synthesisPrompt.build({
      originalPrompt,
      reports,
      ctx: synthesisContext,
      additionalSources,
    });
    const result = await this.client.generate(
      synthesisPromptText,
      this.generateOptions(options?.promptType ?? 'research-synthesis')
    );

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
    const result = await this.client.generate(builtPrompt, this.generateOptions('research-title-generation'));

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

  async generateContextLabel(content: string): Promise<Result<LabelGenerateResult, LlmError>> {
    const result = await this.client.generate(
      labelPrompt.build({ content }),
      this.generateOptions('research-context-label-generation')
    );
    if (!result.ok) return { ok: false, error: mapToLlmError(result.error) };
    return {
      ok: true,
      value: {
        label: result.value.content.trim(),
        usage: result.value.usage,
      },
    };
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED', 'OVERLOADED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}
