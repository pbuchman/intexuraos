/**
 * Parses and validates LLM-generated summary responses.
 * Handles markdown code blocks, JSON detection, and unwanted prefixes.
 */

import type { Result, Logger } from '@intexuraos/common-core';
import { err, ok, getErrorMessage } from '@intexuraos/common-core';
import { createDetailedParseErrorMessage } from '@intexuraos/llm-common';

/**
 * Parsed and validated summary.
 */
export interface ParsedSummary {
  summary: string;
  wordCount: number;
}

/**
 * Error from parsing summary response.
 */
export interface ParseError {
  code: 'EMPTY' | 'JSON_FORMAT';
  message: string;
}

/**
 * Error class for parse failures with code.
 */
class ParseValidationError extends Error {
  constructor(
    public readonly code: ParseError['code'],
    message: string
  ) {
    super(message);
    this.name = 'ParseValidationError';
  }
}

const EXPECTED_SCHEMA = `Plain prose text summary (no JSON, no markdown code blocks, no meta-commentary).

Requirements:
- Non-empty content
- Not JSON format (no objects or arrays)
- Optional: Strips "Here is", "Summary:", "The summary", "Below is" prefixes
- Word count calculated from content`;

/**
 * Counts words in a string.
 */
function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Checks if a string is valid JSON.
 *
 * Any error during JSON.parse means it's not valid JSON - this is expected behavior.
 * We're using this as a type guard (to detect JSON format), not for parsing,
 * so errors aren't actionable and don't need logging.
 */
function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

/**
 * Strips unwanted prefixes from summary.
 * Handles case variations by comparing lowercase versions.
 */
function stripUnwantedPrefixes(content: string): string {
  const lowerContent = content.toLowerCase();
  const unwantedPrefixes = [
    'here is',
    'summary:',
    'the summary',
    'below is',
    "here's",
    'the following is',
  ];

  for (const prefix of unwantedPrefixes) {
    if (lowerContent.startsWith(prefix)) {
      const prefixLength = prefix.length;
      // Check if we're at end of string or followed by space/colon/newline
      if (prefixLength >= content.length) {
        return ''; // Prefix covers entire content
      }
      const nextChar = content.charAt(prefixLength);
      if (/^[\s:\n]/.test(nextChar)) {
        return content.slice(prefixLength).trim();
      }
    }
  }

  return content;
}

/**
 * Parses and validates an LLM-generated summary response with enhanced error logging.
 *
 * @param content - Raw content from LLM response
 * @param logger - Logger for error context
 * @returns Result with parsed summary or ParseError
 */
export function parseSummaryResponse(
  content: string,
  logger: Logger
): Result<ParsedSummary, ParseError> {
  try {
    return ok(parseSummaryResponseInternal(content));
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown parse error');

    const detailedMessage = createDetailedParseErrorMessage({
      errorMessage,
      llmResponse: content,
      expectedSchema: EXPECTED_SCHEMA,
      operation: 'parseSummaryResponse',
    });

    logger.warn(
      {
        operation: 'parseSummaryResponse',
        errorMessage,
        llmResponse: content.slice(0, 500),
        responseLength: content.length,
      },
      'LLM summary parse error'
    );

    const code = error instanceof ParseValidationError ? error.code : 'EMPTY';

    return err({
      code,
      message: detailedMessage,
    });
  }
}

/**
 * Internal parsing logic without error logging wrapper.
 * Throws ParseValidationError on validation failure.
 */
function parseSummaryResponseInternal(content: string): ParsedSummary {
  let cleaned = content.trim();

  cleaned = cleaned.replace(/^```(markdown|text)?\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/i, '');
  cleaned = cleaned.trim();

  if (cleaned.length === 0) {
    throw new ParseValidationError('EMPTY', 'Summary is empty after cleaning');
  }

  if (cleaned.startsWith('[') || cleaned.startsWith('{')) {
    if (isValidJson(cleaned)) {
      throw new ParseValidationError('JSON_FORMAT', 'Response is JSON format - expected prose text');
    }
  }

  const finalContent = stripUnwantedPrefixes(cleaned);

  if (finalContent.length === 0) {
    throw new ParseValidationError('EMPTY', 'Summary is empty after stripping prefixes');
  }

  return {
    summary: finalContent,
    wordCount: countWords(finalContent),
  };
}

/**
 * Parses and validates an LLM-generated summary response (for testing without logger).
 *
 * @param content - Raw content from LLM response
 * @returns Result with parsed summary or ParseError
 */
export function parseSummaryResponseSync(content: string): Result<ParsedSummary, ParseError> {
  try {
    return ok(parseSummaryResponseInternal(content));
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown parse error');

    const detailedMessage = createDetailedParseErrorMessage({
      errorMessage,
      llmResponse: content,
      expectedSchema: EXPECTED_SCHEMA,
      operation: 'parseSummaryResponse',
    });

    const code = error instanceof ParseValidationError ? error.code : 'EMPTY';

    return err({
      code,
      message: detailedMessage,
    });
  }
}
