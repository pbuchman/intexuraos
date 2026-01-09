/**
 * Context inference adapter using Gemini Flash for fast context extraction.
 * Usage logging is handled by the client (packages/infra-gemini).
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import type { ModelPricing } from '@intexuraos/llm-contract';
import {
  buildInferResearchContextPrompt,
  buildInferSynthesisContextPrompt,
  isResearchContext,
  isSynthesisContext,
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
} from '@intexuraos/llm-common';
import { getErrorMessage, type Result } from '@intexuraos/common-core';
import type { LlmError } from '../../domain/research/ports/llmProvider.js';
import type {
  ContextInferenceProvider,
  ResearchContextResult,
  SynthesisContextResult,
} from '../../domain/research/ports/contextInference.js';
import type { Logger } from '@intexuraos/common-core';

export class ContextInferenceAdapter implements ContextInferenceProvider {
  private readonly client: GeminiClient;
  private readonly logger: Logger | undefined;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    pricing: ModelPricing,
    logger?: Logger
  ) {
    this.client = createGeminiClient({ apiKey, model, userId, pricing });
    this.logger = logger;
  }

  async inferResearchContext(
    userQuery: string,
    opts?: InferResearchContextOptions
  ): Promise<Result<ResearchContextResult, LlmError>> {
    const prompt = buildInferResearchContextPrompt(userQuery, opts);
    const result = await this.client.generate(prompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }

    const parsed = parseJson(result.value.content, isResearchContext);
    if (!parsed.ok) {
      this.logger?.warn({ error: parsed.error }, 'Failed to parse research context');
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: parsed.error,
          usage: {
            inputTokens: result.value.usage.inputTokens,
            outputTokens: result.value.usage.outputTokens,
            costUsd: result.value.usage.costUsd,
          },
        },
      };
    }

    const { usage } = result.value;
    return {
      ok: true,
      value: {
        context: parsed.value,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }

  async inferSynthesisContext(
    params: InferSynthesisContextParams
  ): Promise<Result<SynthesisContextResult, LlmError>> {
    const prompt = buildInferSynthesisContextPrompt(params);
    const result = await this.client.generate(prompt);

    if (!result.ok) {
      return { ok: false, error: mapToLlmError(result.error) };
    }

    const parsed = parseJson(result.value.content, isSynthesisContext);
    if (!parsed.ok) {
      this.logger?.warn({ error: parsed.error }, 'Failed to parse synthesis context');
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: parsed.error,
          usage: {
            inputTokens: result.value.usage.inputTokens,
            outputTokens: result.value.usage.outputTokens,
            costUsd: result.value.usage.costUsd,
          },
        },
      };
    }

    const { usage } = result.value;
    return {
      ok: true,
      value: {
        context: parsed.value,
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

function parseJson<T>(
  raw: string,
  guard: (v: unknown) => v is T
): { ok: true; value: T } | { ok: false; error: string } {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `JSON parse error: ${getErrorMessage(e)}` };
  }

  if (!guard(parsed)) {
    return { ok: false, error: 'Response does not match expected schema' };
  }

  return { ok: true, value: parsed };
}
