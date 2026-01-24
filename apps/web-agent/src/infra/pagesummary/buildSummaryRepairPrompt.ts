/**
 * Builds prompts for LLM-based page summarization.
 * Uses PromptBuilder pattern for consistency with llm-common.
 */

import type { PromptBuilder, PromptDeps } from '@intexuraos/llm-prompts';

/**
 * Input for the initial summary prompt.
 */
export interface SummaryPromptInput {
  /** Maximum number of sentences in the summary */
  maxSentences: number;
  /** Maximum reading time in minutes */
  maxReadingMinutes: number;
}

/**
 * Dependencies for the summary prompt.
 */
export interface SummaryPromptDeps extends PromptDeps {
  /** Custom words per minute calculation (default: 200) */
  wordsPerMinute?: number;
}

/**
 * Input for the repair prompt when initial response is invalid.
 */
export interface SummaryRepairPromptInput {
  /** Original page content that was being summarized */
  originalContent: string;
  /** The invalid response from the LLM */
  invalidResponse: string;
  /** Error message explaining why the response was invalid */
  errorMessage: string;
}

/**
 * Dependencies for the repair prompt.
 */
export interface SummaryRepairPromptDeps extends PromptDeps {
  /** Maximum content length to include in repair prompt (default: 5000) */
  contentMaxLength?: number;
  /** Maximum invalid response length to include (default: 1000) */
  invalidResponseMaxLength?: number;
  /** Override default sentence/word limits */
  maxSentences?: number;
  maxWords?: number;
}

/**
 * Formats the requirements section for prompts.
 */
function formatRequirements(
  maxSentences: number,
  maxWords: number
): string {
  return `## REQUIREMENTS
- Maximum ${String(maxSentences)} sentences
- Maximum ${String(maxWords)} words
- IMPORTANT: Write the summary in the SAME LANGUAGE as the original content (if Polish, write in Polish; if German, write in German; etc.)
- Extract all relevant points from the page
- If there are multiple subjects, provide pointed summaries for each specific topic
- Focus on key information, facts, and main ideas
- Use clear, concise language
- Do not include any meta-commentary about the summary itself`;
}

/**
 * Formats the output format section with critical formatting rules.
 */
function formatOutputFormat(): string {
  return `## OUTPUT FORMAT
CRITICAL: Output ONLY plain prose text
- NO JSON format (no objects, arrays, or key-value pairs)
- NO markdown code blocks (no \`\`\` wrapping)
- NO prefixes like "Here is", "Summary:", "The summary", "Below is"
- Start directly with the summary content`;
}

/**
 * LLM prompt for generating initial page summary.
 */
export const summaryPrompt: PromptBuilder<SummaryPromptInput, SummaryPromptDeps> = {
  name: 'page-summary-generation',
  description: 'Generates concise prose summaries from web page content',

  build(input: SummaryPromptInput, deps?: SummaryPromptDeps): string {
    const wordsPerMinute = deps?.wordsPerMinute ?? 200;
    const maxWords = input.maxReadingMinutes * wordsPerMinute;

    return `## Your Task
Summarize the following web page content.

${formatRequirements(input.maxSentences, maxWords)}

${formatOutputFormat()}

---

## Content to Summarize
[Content will be appended here]`;
  },
};

/**
 * LLM prompt for repairing invalid summary responses.
 */
export const summaryRepairPrompt: PromptBuilder<
  SummaryRepairPromptInput,
  SummaryRepairPromptDeps
> = {
  name: 'page-summary-repair',
  description: 'Requests LLM to fix invalid summary response format',

  build(input: SummaryRepairPromptInput, deps?: SummaryRepairPromptDeps): string {
    const contentMaxLength = deps?.contentMaxLength ?? 5000;
    const invalidResponseMaxLength = deps?.invalidResponseMaxLength ?? 1000;
    const maxSentences = deps?.maxSentences ?? 20;
    const maxWords = deps?.maxWords ?? 600;

    const truncatedContent =
      input.originalContent.length > contentMaxLength
        ? input.originalContent.slice(0, contentMaxLength) + '...'
        : input.originalContent;

    const truncatedInvalid =
      input.invalidResponse.length > invalidResponseMaxLength
        ? input.invalidResponse.slice(0, invalidResponseMaxLength) + '...'
        : input.invalidResponse;

    return `## Your Task
Your previous summary was invalid. Please provide ONLY the summary text, following the format requirements below.

## ERROR
${input.errorMessage}

## INVALID RESPONSE
"""
${truncatedInvalid}
"""

${formatRequirements(maxSentences, maxWords)}

${formatOutputFormat()}

---

## Original Content to Summarize
"""
${truncatedContent}
---

Provide ONLY the corrected summary text:`;
  },
};

/**
 * Convenience function: builds the initial summary prompt.
 * @deprecated Use `summaryPrompt.build()` directly for better type safety.
 *
 * @param maxSentences - Maximum number of sentences in the summary
 * @param maxReadingMinutes - Maximum reading time in minutes
 * @returns Summary prompt string
 */
export function buildSummaryPrompt(
  maxSentences: number,
  maxReadingMinutes: number
): string {
  return summaryPrompt.build({ maxSentences, maxReadingMinutes });
}

/**
 * Convenience function: builds a prompt to request LLM repair an invalid summary response.
 * @deprecated Use `summaryRepairPrompt.build()` directly for better type safety.
 *
 * @param originalContent - Original page content that was being summarized
 * @param invalidResponse - The invalid response from the LLM
 * @param errorMessage - Error message explaining why the response was invalid
 * @returns Repair prompt string
 */
export function buildSummaryRepairPrompt(
  originalContent: string,
  invalidResponse: string,
  errorMessage: string
): string {
  return summaryRepairPrompt.build({ originalContent, invalidResponse, errorMessage });
}
