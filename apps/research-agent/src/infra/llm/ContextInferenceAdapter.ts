/**
 * Context inference adapter using the unified LLM factory.
 * Platform calls use the canonical OpenRouter model.
 */

import { createLlmClient, type LlmGenerateClient } from '@intexuraos/llm-factory';
import type { OpenRouterModelId } from '@intexuraos/llm-contract';
import type { UsageSink } from '@intexuraos/llm-pricing';
import {
  inferResearchContextPrompt,
  inferSynthesisContextPrompt,
  researchContextRepairPrompt,
  synthesisContextRepairPrompt,
  ResearchContextSchema,
  SynthesisContextSchema,
  type InferResearchContextOptions,
  type InferSynthesisContextParams,
} from '@intexuraos/llm-prompts';
import { createDetailedParseErrorMessage } from '@intexuraos/llm-utils';
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
  "domain": string (e.g., "technical", "legal", "outdoor_recreation", "fishing"),
  "mode": string (e.g., "standard", "deep"),
  "intent_summary": string,
  "defaults_applied": Array<{ key, value, reason }>,
  "assumptions": string[],
  "answer_style": string[],
  "time_scope": { as_of_date, prefers_recent_years, is_time_sensitive },
  "locale_scope": { country_or_region, jurisdiction, currency },
  "research_plan": { key_questions, search_queries, preferred_source_types, avoid_source_types },
  "output_format": { wants_table, wants_steps, wants_pros_cons, wants_budget_numbers },
  "safety": { high_stakes, required_disclaimers, user_exclusions },
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
  "safety": { high_stakes, required_disclaimers, user_exclusions },
  "red_flags": string[]
}`;

export class ContextInferenceAdapter implements ContextInferenceProvider {
  private readonly client: LlmGenerateClient;
  private readonly logger: Logger;
  /**
   * Optional research correlation token baked at construction time. When the
   * adapter is built inside `handleAllCompleted`'s synthesis path the live
   * researchId must travel with every internal `client.generate()` call so
   * llm-usage-service can attribute context-inference cost to the research.
   */
  private readonly researchId?: string;

  constructor(
    apiKey: string,
    model: OpenRouterModelId,
    userId: string,
    logger: Logger,
    usageSink: UsageSink,
    researchId?: string
  ) {
    this.client = createLlmClient({
      apiKey,
      model,
      userId,
      logger,
      usageSink,
    });
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

  async inferResearchContext(
    userQuery: string,
    opts?: InferResearchContextOptions
  ): Promise<Result<ResearchContextResult, LlmError>> {
    const prompt = inferResearchContextPrompt.build({ userQuery, opts });
    const result = await this.client.generate(prompt, this.generateOptions('research-context-inference'));

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
      this.logger.debug(
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

    const { usage } = result.value; // @allow-result-access -- result.ok narrowed at line 99 earlier in function
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
    const prompt = inferSynthesisContextPrompt.build(params);
    const result = await this.client.generate(prompt, this.generateOptions('research-synthesis-context-inference'));

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
      this.logger.debug(
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

    const { usage } = result.value; // @allow-result-access -- result.ok narrowed at line 160 earlier in function
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
    const repairPrompt = researchContextRepairPrompt.build({
      originalQuery: userQuery,
      invalidResponse,
      errorMessage,
    });
    const result = await this.client.generate(repairPrompt, this.generateOptions('research-context-inference-repair'));

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

    this.logger.debug({}, 'Repair attempt succeeded');
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
    const repairPrompt = synthesisContextRepairPrompt.build({
      originalPrompt: params.originalPrompt,
      invalidResponse,
      errorMessage,
    });
    const result = await this.client.generate(repairPrompt, this.generateOptions('research-synthesis-context-inference-repair'));

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

    this.logger.debug({}, 'Repair attempt succeeded');
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

/**
 * Safely stringify a value for logging, handling circular references.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[Unable to stringify]';
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
const MAX_ZOD_ISSUES = 5;

function formatZodErrors(error: ZodError): string {
  /* v8 ignore start -- schema: ZodError always has at least one issue by construction @preserve */
  if (error.issues.length === 0) {
  /* v8 ignore stop @preserve */
    return 'Unknown validation error (no issues reported)';
  }

  const totalIssues = error.issues.length;
  const issuesToReport = error.issues.slice(0, MAX_ZOD_ISSUES);
  const truncatedCount = totalIssues - issuesToReport.length;

  const formatted = issuesToReport
    .map((issue) => {
      const path = issue.path.join('.');
      const pathStr = path !== '' ? path : '(root)';

      if (issue.code === 'invalid_enum_value' && 'options' in issue && 'received' in issue) {
        const options = (issue.options as string[]).map((o) => `'${o}'`).join(' | ');
        return `${pathStr}: expected ${options}, received '${String(issue.received)}'`;
      }

      /* v8 ignore start -- ts-type: Zod error type narrowing after 'in' checks @preserve */
      if (issue.code === 'invalid_type' && 'expected' in issue && 'received' in issue) {
      /* v8 ignore stop @preserve */
        const expected = issue.expected as string;
        const received = issue.received as string;
        return `${pathStr}: expected ${expected}, received ${received}`;
      }

      return `${pathStr}: ${issue.message}`;
    })
    .join('; ');

  if (truncatedCount > 0) {
    return `${formatted}; ... and ${String(truncatedCount)} more issue(s)`;
  }
  return formatted;
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
        parsedJson: safeStringify(parsed),
      },
      `LLM parse error in ${operation}: Schema validation failed`
    );
    return { ok: false, error: detailedError };
  }

  return { ok: true, value: result.data };
}
