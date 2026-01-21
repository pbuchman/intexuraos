/**
 * Context inference adapter using Gemini Flash for fast context extraction.
 * Usage logging is handled by the client (packages/infra-gemini).
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import type { ModelPricing } from '@intexuraos/llm-contract';
import {
  buildInferResearchContextPrompt,
  buildInferSynthesisContextPrompt,
  buildResearchContextRepairPrompt,
  buildSynthesisContextRepairPrompt,
  createDetailedParseErrorMessage,
  ResearchContextSchema,
  SynthesisContextSchema,
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
} from '@intexuraos/llm-common';
import { type Result, getErrorMessage } from '@intexuraos/common-core';
import type { LlmError } from '../../domain/research/ports/llmProvider.js';
import type {
  ContextInferenceProvider,
  ResearchContextResult,
  SynthesisContextResult,
} from '../../domain/research/ports/contextInference.js';
import type { Logger } from '@intexuraos/common-core';
import type { ZodSchema, ZodError } from 'zod';

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
  "detected_conflicts": Array<{ topic, sources_involved, conflict_summary, severity }>,
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

    const parsed = parseJsonWithZod(
      result.value.content,
      ResearchContextSchema,
      'inferResearchContext',
      RESEARCH_CONTEXT_SCHEMA,
      this.logger
    );

    if (!parsed.ok) {
      this.logger.info(
        { errorMessage: parsed.error },
        'Schema validation failed, attempting repair'
      );
      const repairResult = await this.attemptResearchContextRepair(
        userQuery,
        result.value.content,
        parsed.error
      );

      if (repairResult.ok) {
        return { ok: true, value: repairResult.value };
      }

      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: repairResult.error,
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

    const parsed = parseJsonWithZod(
      result.value.content,
      SynthesisContextSchema,
      'inferSynthesisContext',
      SYNTHESIS_CONTEXT_SCHEMA,
      this.logger
    );

    if (!parsed.ok) {
      this.logger.info(
        { errorMessage: parsed.error },
        'Schema validation failed, attempting repair'
      );
      const repairResult = await this.attemptSynthesisContextRepair(
        params,
        result.value.content,
        parsed.error
      );

      if (repairResult.ok) {
        return { ok: true, value: repairResult.value };
      }

      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: repairResult.error,
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

  private async attemptResearchContextRepair(
    userQuery: string,
    invalidResponse: string,
    errorMessage: string
  ): Promise<Result<ResearchContextResult, string>> {
    const repairPrompt = buildResearchContextRepairPrompt(
      userQuery,
      invalidResponse,
      errorMessage
    );
    const result = await this.client.generate(repairPrompt);

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      return { ok: false, error: `${error.message} (repair attempt)` };
    }

    const parsed = parseJsonWithZod(
      result.value.content,
      ResearchContextSchema,
      'inferResearchContext',
      RESEARCH_CONTEXT_SCHEMA,
      this.logger
    );

    if (!parsed.ok) {
      this.logger.warn(
        { firstError: errorMessage, secondError: parsed.error },
        'Repair attempt failed'
      );
      return { ok: false, error: `Initial: ${errorMessage}. Repair: ${parsed.error}` };
    }

    this.logger.info({}, 'Repair attempt succeeded');
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

  private async attemptSynthesisContextRepair(
    params: InferSynthesisContextParams,
    invalidResponse: string,
    errorMessage: string
  ): Promise<Result<SynthesisContextResult, string>> {
    const repairPrompt = buildSynthesisContextRepairPrompt(
      {
        originalPrompt: params.originalPrompt,
        reports: params.reports ?? [],
        additionalSources: (params.additionalSources ?? []).filter(
          (s): s is { content: string; label: string } => s.label !== undefined
        ),
      },
      invalidResponse,
      errorMessage
    );
    const result = await this.client.generate(repairPrompt);

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      return { ok: false, error: `${error.message} (repair attempt)` };
    }

    const parsed = parseJsonWithZod(
      result.value.content,
      SynthesisContextSchema,
      'inferSynthesisContext',
      SYNTHESIS_CONTEXT_SCHEMA,
      this.logger
    );

    if (!parsed.ok) {
      this.logger.warn(
        { firstError: errorMessage, secondError: parsed.error },
        'Repair attempt failed'
      );
      return { ok: false, error: `Initial: ${errorMessage}. Repair: ${parsed.error}` };
    }

    this.logger.info({}, 'Repair attempt succeeded');
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

/**
 * Formats Zod validation errors into a human-readable string with field paths.
 * Each error shows the exact field path and what went wrong.
 *
 * @example
 * // Returns: "mode: expected 'compact' | 'standard' | 'audit', received 'deep'"
 * // Returns: "research_plan.preferred_source_types.0: expected 'official' | ..., received 'blog'"
 */
function formatZodErrors(error: ZodError): string {
  if (error.issues.length === 0) {
    return 'Unknown validation error (no issues reported)';
  }

  return error.issues
    .map((issue) => {
      const path = issue.path.join('.');
      const pathStr = path !== '' ? path : '(root)';

      if (issue.code === 'invalid_enum_value' && 'options' in issue && 'received' in issue) {
        const options = (issue.options as string[]).map((o) => `'${o}'`).join(' | ');
        return `${pathStr}: expected ${options}, received '${String(issue.received)}'`;
      }

      if (issue.code === 'invalid_type' && 'expected' in issue && 'received' in issue) {
        const expected = issue.expected as string;
        const received = issue.received as string;
        return `${pathStr}: expected ${expected}, received ${received}`;
      }

      return `${pathStr}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Parse JSON string and validate against a Zod schema.
 * Provides detailed error paths when validation fails.
 */
function parseJsonWithZod<T>(
  raw: string,
  schema: ZodSchema<T>,
  operation: string,
  expectedSchema: string,
  logger: Logger
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
    const parseError = getErrorMessage(e, 'Unknown parse error');
    const errorMessage = `JSON parse failed: ${parseError}`;
    const detailedError = createDetailedParseErrorMessage({
      errorMessage,
      llmResponse: raw,
      expectedSchema,
      operation,
    });
    logger.warn(
      {
        operation,
        errorMessage,
        parseError,
        llmResponse: raw,
        expectedSchema,
        responseLength: raw.length,
      },
      `LLM parse error in ${operation}: JSON parse failed`
    );
    return { ok: false, error: detailedError };
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    const zodErrorDetails = formatZodErrors(result.error);
    const errorMessage = `Schema validation failed: ${zodErrorDetails}`;
    const detailedError = createDetailedParseErrorMessage({
      errorMessage,
      llmResponse: raw,
      expectedSchema,
      operation,
    });
    logger.warn(
      {
        operation,
        errorMessage,
        zodErrors: result.error.issues,
        llmResponse: raw,
        expectedSchema,
        responseLength: raw.length,
        parsedJson: JSON.stringify(parsed),
      },
      `LLM parse error in ${operation}: Schema validation failed`
    );
    return { ok: false, error: detailedError };
  }

  return { ok: true, value: result.data };
}
