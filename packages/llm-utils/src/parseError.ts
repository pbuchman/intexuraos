/**
 * Enhanced error logging for LLM response parsing failures.
 *
 * This utility provides structured error details that include:
 * - The raw LLM response that failed parsing
 * - The expected schema/structure
 * - The prompt that was sent (optional, for context)
 *
 * This information is crucial for:
 * 1. Debugging why LLMs fail to produce expected outputs
 * 2. Iterating on prompts to improve compliance
 * 3. Identifying patterns in LLM failures
 * 4. Creating targeted fixes for specific models/providers
 */

import type { Logger } from '@intexuraos/common-core';
import { getErrorMessage } from '@intexuraos/common-core';
import type { ZodIssue, ZodError } from 'zod';

/**
 * Error details from LLM response parsing failures.
 */
export interface LlmParseErrorDetails {
  /** The error message from the parser */
  errorMessage: string;
  /** The raw LLM response that failed parsing (truncated if too long) */
  llmResponse: string;
  /** Description of what was expected */
  expectedSchema: string;
  /** The prompt that was sent (optional, for additional context) */
  prompt?: string;
  /** Name of the operation/function that failed */
  operation: string;
}

/**
 * Truncate a string to a maximum length, appending an indicator if truncated.
 */
function truncate(value: string, maxLength = 1000): string {
  if (value.length <= maxLength) return value;
  const originalLength = value.length;
  return `${value.slice(0, maxLength)}... [truncated, original length: ${String(originalLength)}]`;
}

/**
 * Create an enhanced error object with full context for debugging.
 *
 * @param options - The error context options
 * @returns An error object with all debugging context
 */
export function createLlmParseError(options: {
  errorMessage: string;
  llmResponse: string;
  expectedSchema: string;
  operation: string;
  prompt?: string;
}): LlmParseErrorDetails {
  return {
    errorMessage: options.errorMessage,
    llmResponse: truncate(options.llmResponse),
    expectedSchema: options.expectedSchema,
    operation: options.operation,
    ...(options.prompt !== undefined && { prompt: truncate(options.prompt, 500) }),
  };
}

/**
 * Log an LLM parsing error with full context.
 *
 * This function logs the error in a structured format that can be easily
 * queried in logging systems and Sentry.
 *
 * @param logger - The logger instance
 * @param details - The error details from createLlmParseError
 */
export function logLlmParseError(logger: Logger, details: LlmParseErrorDetails): void {
  logger.warn(
    {
      operation: details.operation,
      errorMessage: details.errorMessage,
      llmResponse: details.llmResponse,
      expectedSchema: details.expectedSchema,
      ...(details.prompt !== undefined && { prompt: details.prompt }),
      responseLength: details.llmResponse.length,
    },
    `LLM parse error in ${details.operation}: ${details.errorMessage}`
  );
}

/**
 * Wrap a parser function with enhanced error logging.
 *
 * Usage example:
 * ```ts
 * const safeParse = withLlmParseErrorLogging({
 *   logger,
 *   operation: 'parseChartDefinition',
 *   expectedSchema: 'CHART_CONFIG_START {...json...} CHART_CONFIG_END TRANSFORM_INSTRUCTIONS_START ... TRANSFORM_INSTRUCTIONS_END',
 *   parser: parseChartDefinition,
 * });
 *
 * const result = safeParse(llmResponse);
 * if (!result.ok) {
 *   // Error has already been logged with full context
 *   return err(result.error);
 * }
 * ```
 */
export function withLlmParseErrorLogging<TInput, TOutput>(options: {
  logger: Logger;
  operation: string;
  expectedSchema: string;
  parser: (input: TInput) => TOutput;
  getPrompt?: () => string;
}): (input: TInput) => TOutput {
  return (input: TInput) => {
    try {
      return options.parser(input);
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      const errorDetails = createLlmParseError({
        errorMessage,
        llmResponse: String(input),
        expectedSchema: options.expectedSchema,
        operation: options.operation,
        ...(options.getPrompt !== undefined && { prompt: options.getPrompt() }),
      });

      logLlmParseError(options.logger, errorDetails);

      throw error;
    }
  };
}

/**
 * Create a structured error message for Result-based errors.
 *
 * For functions that return Result<T, E> instead of throwing,
 * use this to create a detailed error that includes the LLM response.
 */
export function createDetailedParseErrorMessage(options: {
  errorMessage: string;
  llmResponse: string;
  expectedSchema: string;
  operation: string;
}): string {
  const truncated = truncate(options.llmResponse, 500);
  return `${options.errorMessage}

Expected: ${options.expectedSchema}

Received (first 500 chars):
${truncated}`;
}

/**
 * Format Zod validation errors into human-readable messages.
 *
 * Limits output to prevent log bloat (max 5 issues) and provides
 * field-level error paths for debugging.
 *
 * @param error - The Zod error object
 * @returns A formatted error string with field paths and descriptions
 *
 * @example
 * ```ts
 * const result = schema.safeParse(data);
 * if (!result.success) {
 *   const errorMsg = formatZodErrors(result.error);
 *   // "quality: expected 0 | 1 | 2, received '5'"
 * }
 * ```
 */
export function formatZodErrors(error: ZodError): string {
  const MAX_ISSUES = 5;

  if (error.issues.length === 0) {
    return 'Unknown validation error (no issues reported)';
  }

  const totalIssues = error.issues.length;
  const issuesToReport = error.issues.slice(0, MAX_ISSUES);

  const formatted = issuesToReport
    .map((issue: ZodIssue) => {
      const path = issue.path.join('.');
      const pathStr = path !== '' ? path : '(root)';

      if (issue.code === 'invalid_enum_value') {
        const options = (issue.options as unknown[]).map((o) => `'${String(o)}'`).join(' | ');
        return `${pathStr}: expected ${options}, received "${String(issue.received)}"`;
      }

      if (issue.code === 'invalid_type') {
        const expected = issue.expected as string;
        return `${pathStr}: expected ${expected}, received "${issue.received}"`;
      }

      if (issue.code === 'invalid_union') {
        // Union errors don't provide detailed options in a type-safe way
        // Use the default message
        return `${pathStr}: ${issue.message}`;
      }

      return `${pathStr}: ${issue.message}`;
    })
    .join('; ');

  if (totalIssues > MAX_ISSUES) {
    return `${formatted}... (+${String(totalIssues - MAX_ISSUES)} more)`;
  }

  return formatted;
}
