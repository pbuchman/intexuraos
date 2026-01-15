/**
 * Context inference adapter using Gemini Flash for fast context extraction.
 * Usage logging is handled by the client (packages/infra-gemini).
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import type { ModelPricing } from '@intexuraos/llm-contract';
import {
  buildInferResearchContextPrompt,
  buildInferSynthesisContextPrompt,
  createDetailedParseErrorMessage,
  isResearchContext,
  isSynthesisContext,
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
} from '@intexuraos/llm-common';
import { type Result } from '@intexuraos/common-core';
import type { LlmError } from '../../domain/research/ports/llmProvider.js';
import type {
  ContextInferenceProvider,
  ResearchContextResult,
  SynthesisContextResult,
} from '../../domain/research/ports/contextInference.js';
import type { Logger } from '@intexuraos/common-core';

/**
 * Expected schema for research context response.
 * JSON object with all required ResearchContext fields.
 */
const RESEARCH_CONTEXT_SCHEMA = `{
  "language": string (e.g., "en"),
  "domain": string (e.g., "technical", "legal"),
  "mode": string (e.g., "standard", "deep"),
  "intent_summary": string,
  "defaults_applied": Array<{ key, value, reason }>,
  "assumptions": string[],
  "answer_style": string[],
  "time_scope": { as_of_date, prefers_recent_years, is_time_sensitive },
  "locale_scope": { country_or_region, jurisdiction, currency },
  "research_plan": { key_questions, search_queries, preferred_source_types, avoid_source_types },
  "output_format": { wants_table, wants_steps, wants_pros_cons, wants_budget_numbers },
  "safety": { high_stakes, required_disclaimers },
  "red_flags": string[]
}`;

/**
 * Expected schema for synthesis context response.
 * JSON object with all required SynthesisContext fields.
 */
const SYNTHESIS_CONTEXT_SCHEMA = `{
  "language": string,
  "domain": string,
  "mode": string,
  "synthesis_goals": string[],
  "missing_sections": string[],
  "detected_conflicts": Array<{ description, severity }>,
  "source_preference": { prefer_official_over_aggregators, prefer_recent_when_time_sensitive },
  "defaults_applied": Array<{ key, value, reason }>,
  "assumptions": string[],
  "output_format": { wants_table, wants_actionable_summary },
  "safety": { high_stakes, required_disclaimers },
  "red_flags": string[]
}`;

export class ContextInferenceAdapter implements ContextInferenceProvider {
  private readonly client: GeminiClient;
  private readonly logger: Logger;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    pricing: ModelPricing,
    logger: Logger
  ) {
    this.client = createGeminiClient({ apiKey, model, userId, pricing, logger });
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

    const parsed = parseJson(
      result.value.content,
      isResearchContext,
      'inferResearchContext',
      RESEARCH_CONTEXT_SCHEMA,
      this.logger
    );
    if (!parsed.ok) {
      this.logger.warn({ error: parsed.error }, 'Failed to parse research context');
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

    const parsed = parseJson(
      result.value.content,
      isSynthesisContext,
      'inferSynthesisContext',
      SYNTHESIS_CONTEXT_SCHEMA,
      this.logger
    );
    if (!parsed.ok) {
      this.logger.warn({ error: parsed.error }, 'Failed to parse synthesis context');
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
  guard: (v: unknown) => v is T,
  operation: string,
  expectedSchema: string,
  logger?: Logger
): { ok: true; value: T } | { ok: false; error: string } {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const errorMessage = `JSON parse failed: Invalid JSON in response`;
    const detailedError = createDetailedParseErrorMessage({
      errorMessage,
      llmResponse: raw,
      expectedSchema,
      operation,
    });
    logger?.warn(
      {
        operation,
        errorMessage,
        llmResponse: raw,
        expectedSchema,
        responseLength: raw.length,
      },
      `LLM parse error in ${operation}: JSON parse failed`
    );
    return { ok: false, error: detailedError };
  }

  if (!guard(parsed)) {
    const errorMessage = 'Response does not match expected schema';
    const detailedError = createDetailedParseErrorMessage({
      errorMessage,
      llmResponse: raw,
      expectedSchema,
      operation,
    });
    logger?.warn(
      {
        operation,
        errorMessage,
        llmResponse: raw,
        expectedSchema,
        responseLength: raw.length,
        parsedJson: JSON.stringify(parsed),
      },
      `LLM parse error in ${operation}: Schema validation failed`
    );
    return { ok: false, error: detailedError };
  }

  return { ok: true, value: parsed };
}
