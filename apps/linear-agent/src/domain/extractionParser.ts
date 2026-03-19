/**
 * Parses raw LLM response content into structured ExtractedIssueData.
 * Handles markdown code block stripping, JSON parsing, and Zod validation.
 */

import type { Result } from '@intexuraos/common-core';
import { err, getErrorMessage, ok } from '@intexuraos/common-core';
import { LinearIssueDataSchema } from '@intexuraos/llm-prompts';
import { formatZodErrors } from '@intexuraos/llm-utils';
import type { ExtractedIssueData } from './models.js';
import type { LinearError } from './errors.js';

const CODE_BLOCK_REGEX = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;

/**
 * Parses a raw LLM response string into ExtractedIssueData.
 *
 * Handles:
 * - Markdown code block unwrapping (```json ... ```)
 * - JSON parsing with error reporting
 * - Zod schema validation against LinearIssueDataSchema
 * - Mapping validated data to ExtractedIssueData
 */
export function parseExtractionResponse(
  rawContent: string
): Result<ExtractedIssueData, LinearError> {
  // Clean response (remove markdown code blocks if present)
  let cleaned = rawContent.trim();
  const innerContent = CODE_BLOCK_REGEX.exec(cleaned)?.[1];
  if (innerContent !== undefined) {
    cleaned = innerContent.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return err({
      code: 'EXTRACTION_FAILED',
      message: `Failed to parse: ${getErrorMessage(e)}`,
    });
  }

  const validationResult = LinearIssueDataSchema.safeParse(parsed);
  if (!validationResult.success) {
    const zodErrors = formatZodErrors(validationResult.error);
    return err({
      code: 'EXTRACTION_FAILED',
      message: `LLM returned invalid response format: ${zodErrors}`,
    });
  }

  return ok({
    title: validationResult.data.title,
    priority: validationResult.data.priority,
    functionalRequirements: validationResult.data.functionalRequirements,
    technicalDetails: validationResult.data.technicalDetails,
    valid: validationResult.data.valid,
    error: validationResult.data.error,
    reasoning: validationResult.data.reasoning,
  });
}
