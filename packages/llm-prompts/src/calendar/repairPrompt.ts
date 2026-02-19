/**
 * Repair prompt for calendar event extraction.
 * Used when the initial extraction returns invalid JSON or fails schema validation.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface CalendarExtractionRepairPromptInput {
  /** Original user text that was being extracted */
  originalText: string;
  /** Current date with day of week (e.g., "2026-01-29 Wednesday") */
  currentDate: string;
  /** The invalid response from the previous extraction attempt */
  invalidResponse: string;
  /** Error message describing why the response was invalid */
  errorMessage: string;
}

export interface CalendarExtractionRepairPromptDeps extends PromptDeps {
  /** Maximum length for the invalid response preview (default: 500) */
  maxResponsePreviewLength?: number;
}

export const calendarExtractionRepairPrompt: PromptBuilder<
  CalendarExtractionRepairPromptInput,
  CalendarExtractionRepairPromptDeps
> = {
  name: 'calendar-extraction-repair',
  description: 'Repairs invalid calendar event extraction responses',
  version: '1.0.0',

  build(
    input: CalendarExtractionRepairPromptInput,
    deps?: CalendarExtractionRepairPromptDeps
  ): string {
    const maxPreviewLength = deps?.maxResponsePreviewLength ?? 500;
    const responsePreview =
      input.invalidResponse.length > maxPreviewLength
        ? input.invalidResponse.slice(0, maxPreviewLength) + '...'
        : input.invalidResponse;

    return `Your previous calendar event extraction response was invalid. Please fix it.

ORIGINAL USER MESSAGE:
${input.originalText}

CURRENT DATE: ${input.currentDate}

YOUR PREVIOUS (INVALID) RESPONSE:
${responsePreview}

ERROR:
${input.errorMessage}

REQUIRED OUTPUT FORMAT (JSON object, no markdown):
{
  "summary": "Event title (string, required)",
  "start": "ISO 8601 date-time (YYYY-MM-DDTHH:mm:ss) or date-only (YYYY-MM-DD) or null",
  "end": "ISO 8601 date-time or date-only or null",
  "location": "string or null",
  "description": "string or null",
  "valid": true/false (boolean, required),
  "error": "string or null",
  "reasoning": "string (required)"
}

RULES:
1. Output ONLY valid JSON - no markdown code blocks, no explanatory text
2. All date-time values must be in ISO 8601 format (YYYY-MM-DDTHH:mm:ss or YYYY-MM-DD)
3. Use null for missing optional fields, not undefined or empty string
4. The "valid" field must be a boolean (true or false), not a string
5. The "reasoning" field is required and must explain your extraction logic

Fix the error and provide a valid JSON response:`;
  },
};

/**
 * Convenience function to build the repair prompt.
 */
export function buildCalendarExtractionRepairPrompt(
  originalText: string,
  currentDate: string,
  invalidResponse: string,
  errorMessage: string
): string {
  return calendarExtractionRepairPrompt.build({
    originalText,
    currentDate,
    invalidResponse,
    errorMessage,
  });
}
