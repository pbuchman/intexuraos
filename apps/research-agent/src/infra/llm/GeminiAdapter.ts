/**
 * Gemini adapter implementing LlmResearchProvider and LlmSynthesisProvider.
 * Usage logging is handled by the client (packages/infra-gemini).
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import type { Logger, Result } from '@intexuraos/common-core';
import type { UsageSink } from '@intexuraos/llm-pricing';
import {
  buildResearchPrompt,
  buildSynthesisPrompt,
  titlePrompt,
  labelPrompt,
  type ResearchContext,
  type SynthesisContext,
} from '@intexuraos/llm-prompts';
import type {
  LlmError,
  LlmResearchProvider,
  LlmResearchResult,
  LlmSynthesisProvider,
  LlmSynthesisResult,
  ResearchProviderCallOptions,
  TitleGenerateResult,
  LabelGenerateResult,
} from '../../domain/research/index.js';

export class GeminiAdapter implements LlmResearchProvider, LlmSynthesisProvider {
  private readonly client: GeminiClient;
  private readonly model: string;
  private readonly logger: Logger;
  /**
   * Optional research correlation token baked at construction time. When the
   * adapter is built inside the synthesis/title/context path of
   * `handleAllCompleted`, this is the research being completed — it must
   * travel with every internal `client.generate()` call so usage events
   * carry `correlation.researchId`. Without it, llm-usage-service can't
   * attribute synthesis/title/context cost to the originating research.
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
    this.client = createGeminiClient({
      apiKey,
      model,
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

  /**
   * Builds a `GenerateOptions`-compatible bag with the adapter's
   * `correlation.researchId` baked in (when available). Centralising the
   * shape keeps every synthesize/title/context call consistent.
   */
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
    const builtPrompt = buildResearchPrompt(prompt, ctx);
    this.logger.info({ model: this.model, promptLength: builtPrompt.length }, 'Gemini research started');
    // Per-call researchId from `options` takes precedence over the adapter's
    // baked-in researchId — research() is invoked from the parallel
    // research-orchestration loop where the call site has the live
    // researchId in scope. The fallback to `this.researchId` is meaningful
    // for adapters constructed inside the synthesis path (where the same
    // adapter would not otherwise see the researchId).
    const callResearchId = options?.researchId ?? this.researchId;
    const researchOptions =
      callResearchId !== undefined
        ? { correlation: { researchId: callResearchId } }
        : undefined;
    const result = await this.client.research(builtPrompt, researchOptions);
    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'Gemini research failed'
      );
      return { ok: false, error };
    }
    this.logger.info(
      { model: this.model, usage: result.value.usage },
      'Gemini research completed'
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
      'Gemini synthesis started'
    );
    const synthesisPrompt =
      synthesisContext !== undefined
        ? buildSynthesisPrompt(originalPrompt, reports, synthesisContext, additionalSources)
        : buildSynthesisPrompt(originalPrompt, reports, additionalSources);
    const result = await this.client.generate(synthesisPrompt, this.generateOptions('research-synthesis'));

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'Gemini synthesis failed'
      );
      return { ok: false, error };
    }
    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'Gemini synthesis completed');
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
    this.logger.info({ model: this.model }, 'Gemini title generation started');
    const builtPrompt = titlePrompt.build(
      { content: prompt },
      { wordRange: { min: 5, max: 8 }, includeExamples: true }
    );
    const result = await this.client.generate(builtPrompt, this.generateOptions('research-title-generation'));

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'Gemini title generation failed'
      );
      return { ok: false, error };
    }
    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'Gemini title generation completed');
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
    this.logger.info({ model: this.model, contentLength: content.length }, 'Gemini label generation started');
    const builtPrompt = labelPrompt.build({ content }, { contentPreviewLimit: 2000 });
    const result = await this.client.generate(builtPrompt, this.generateOptions('research-context-label'));

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'Gemini label generation failed'
      );
      return { ok: false, error };
    }
    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'Gemini label generation completed');
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
