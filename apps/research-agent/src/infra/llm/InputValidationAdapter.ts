/**
 * Input validation adapter using Gemini Flash for prompt quality assessment.
 * Usage logging is handled by the client (packages/infra-gemini).
 */

import { createGeminiClient, type GeminiClient } from '@intexuraos/infra-gemini';
import type { ModelPricing } from '@intexuraos/llm-contract';
import {
  buildImprovementRepairPrompt,
  buildValidationRepairPrompt,
  inputImprovementPrompt,
  inputQualityPrompt,
  InputQualitySchema,
} from '@intexuraos/llm-prompts';
import { createLlmParseError, formatZodErrors, logLlmParseError } from '@intexuraos/llm-utils';
import { getErrorMessage, type Logger, type Result } from '@intexuraos/common-core';
import type { LlmError } from '../../domain/research/ports/llmProvider.js';
import type { ZodSchema } from 'zod';

export interface ValidationResult {
  quality: 0 | 1 | 2;
  reason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

export interface ImprovementResult {
  improvedPrompt: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
}

export interface InputValidationProvider {
  validateInput(prompt: string): Promise<Result<ValidationResult, LlmError>>;
  improveInput(prompt: string): Promise<Result<ImprovementResult, LlmError>>;
}

export class InputValidationAdapter implements InputValidationProvider {
  private readonly client: GeminiClient;
  private readonly model: string;
  private readonly logger: Logger;

  constructor(
    apiKey: string,
    model: string,
    userId: string,
    pricing: ModelPricing,
    logger: Logger
  ) {
    this.client = createGeminiClient({ apiKey, model, userId, pricing, logger });
    this.model = model;
    this.logger = logger;
  }

  async validateInput(prompt: string): Promise<Result<ValidationResult, LlmError>> {
    this.logger.info({ model: this.model, promptLength: prompt.length }, 'Input validation started');
    const builtPrompt = inputQualityPrompt.build({ prompt });
    const result = await this.client.generate(builtPrompt);

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'Input validation LLM call failed'
      );
      return { ok: false, error };
    }

    const parsed = parseJsonWithZod(result.value.content, InputQualitySchema);
    if (!parsed.ok) {
      return await this.attemptValidationRepair(prompt, result.value.content, parsed.error, result.value.usage);
    }

    const { usage } = result.value;
    this.logger.info(
      { model: this.model, quality: parsed.value.quality, usage },
      'Input validation completed'
    );
    return {
      ok: true,
      value: {
        quality: parsed.value.quality,
        reason: parsed.value.reason,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }

  async improveInput(prompt: string): Promise<Result<ImprovementResult, LlmError>> {
    this.logger.info({ model: this.model, promptLength: prompt.length }, 'Input improvement started');
    const builtPrompt = inputImprovementPrompt.build({ prompt });
    const result = await this.client.generate(builtPrompt);

    if (!result.ok) {
      const error = mapToLlmError(result.error);
      this.logger.error(
        { model: this.model, errorCode: error.code, errorMessage: error.message },
        'Input improvement failed'
      );
      return { ok: false, error };
    }

    const cleaned = this.cleanImprovedPrompt(result.value.content);
    const validationError = this.validateImprovedPrompt(cleaned, result.value.content);

    if (validationError !== null) {
      return await this.attemptImprovementRepair(prompt, result.value.content, validationError, result.value.usage);
    }

    const { usage } = result.value;
    this.logger.info({ model: this.model, usage }, 'Input improvement completed');
    return {
      ok: true,
      value: {
        improvedPrompt: cleaned,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }

  private async attemptValidationRepair(
    originalPrompt: string,
    invalidResponse: string,
    errorMessage: string,
    initialUsage: { inputTokens: number; outputTokens: number; costUsd: number }
  ): Promise<Result<ValidationResult, LlmError>> {
    logLlmParseError(
      this.logger,
      createLlmParseError({
        errorMessage,
        llmResponse: invalidResponse,
        expectedSchema: '{ quality: 0|1|2, reason: string }',
        operation: 'validateInput',
        prompt: originalPrompt,
      })
    );

    const repairPrompt = buildValidationRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const result = await this.client.generate(repairPrompt);

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: `Initial: ${errorMessage}. Repair: ${result.error.message}`,
          usage: initialUsage,
        },
      };
    }

    const parsed = parseJsonWithZod(result.value.content, InputQualitySchema);
    if (!parsed.ok) {
      logLlmParseError(
        this.logger,
        createLlmParseError({
          errorMessage: parsed.error,
          llmResponse: result.value.content,
          expectedSchema: '{ quality: 0|1|2, reason: string }',
          operation: 'validateInput-repair',
        })
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: `Initial: ${errorMessage}. Repair: ${parsed.error}`,
          usage: initialUsage,
        },
      };
    }

    this.logger.info({ model: this.model, repaired: true }, 'Validation repair succeeded');
    const { usage } = result.value;
    return {
      ok: true,
      value: {
        quality: parsed.value.quality,
        reason: parsed.value.reason,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }

  private async attemptImprovementRepair(
    originalPrompt: string,
    invalidResponse: string,
    errorMessage: string,
    initialUsage: { inputTokens: number; outputTokens: number; costUsd: number }
  ): Promise<Result<ImprovementResult, LlmError>> {
    logLlmParseError(
      this.logger,
      createLlmParseError({
        errorMessage,
        llmResponse: invalidResponse,
        expectedSchema: '<plain text, single sentence, no JSON, no markdown, no explanations>',
        operation: 'improveInput',
        prompt: originalPrompt,
      })
    );

    const repairPrompt = buildImprovementRepairPrompt(originalPrompt, invalidResponse, errorMessage);
    const result = await this.client.generate(repairPrompt);

    if (!result.ok) {
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: `Initial: ${errorMessage}. Repair: ${result.error.message}`,
          usage: initialUsage,
        },
      };
    }

    const cleaned = this.cleanImprovedPrompt(result.value.content);
    const validationError = this.validateImprovedPrompt(cleaned, result.value.content);

    if (validationError !== null) {
      logLlmParseError(
        this.logger,
        createLlmParseError({
          errorMessage: validationError,
          llmResponse: result.value.content,
          expectedSchema: '<plain text, single sentence, no JSON, no markdown, no explanations>',
          operation: 'improveInput-repair',
        })
      );
      return {
        ok: false,
        error: {
          code: 'API_ERROR',
          message: `Initial: ${errorMessage}. Repair: ${validationError}`,
          usage: initialUsage,
        },
      };
    }

    this.logger.info({ model: this.model, repaired: true }, 'Improvement repair succeeded');
    const { usage } = result.value;
    return {
      ok: true,
      value: {
        improvedPrompt: cleaned,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
        },
      },
    };
  }

  private cleanImprovedPrompt(content: string): string {
    return content
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/^(Improved:|Here is:|Result:|Improved prompt:)\s*/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();
  }

  private validateImprovedPrompt(cleaned: string, raw: string): string | null {
    if (cleaned.length === 0) {
      return 'Response is empty after cleaning';
    }

    if (cleaned.length > 500) {
      return 'Response is too long - should be a single concise sentence';
    }

    const lowerContent = raw.toLowerCase();
    const unwantedPrefixes = [
      'here is',
      'the improved',
      'improved version',
      'below is',
      'following is',
      'suggestion:',
    ];

    for (const prefix of unwantedPrefixes) {
      if (lowerContent.startsWith(prefix)) {
        return `Response includes unwanted prefix "${prefix}"`;
      }
    }

    if (raw.includes('{') && raw.includes('}')) {
      return 'Response contains JSON format - should be plain text only';
    }

    if (/\b(explanation|reasoning|notes?|commentary|analysis)\b:/.exec(lowerContent) !== null) {
      return 'Response includes explanatory text - should only contain the improved prompt';
    }

    return null;
  }
}

function mapToLlmError(error: { code: string; message: string }): LlmError {
  const validCodes = ['API_ERROR', 'TIMEOUT', 'INVALID_KEY', 'RATE_LIMITED'] as const;
  const code = validCodes.includes(error.code as (typeof validCodes)[number])
    ? (error.code as LlmError['code'])
    : 'API_ERROR';

  return { code, message: error.message };
}

function parseJsonWithZod<T>(
  raw: string,
  schema: ZodSchema<T>
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

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: formatZodErrors(result.error) };
  }

  return { ok: true, value: result.data };
}
