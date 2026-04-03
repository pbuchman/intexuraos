/**
 * Builds prompts for LLM-based page summarization.
 * Uses PromptBuilder pattern for consistency with llm-common.
 */

import type { PromptBuilder, PromptDeps } from '@intexuraos/llm-prompts';

/**
 * Input for the initial summary prompt.
 */
export interface SummaryPromptInput {
  /** URL of the page being summarized */
  url?: string;
  /** Optional title hint from page metadata */
  title?: string | null;
  /** Optional description hint from page metadata */
  description?: string | null;
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
  /** URL of the page being summarized */
  url?: string;
  /** Optional title hint from page metadata */
  title?: string | null;
  /** Optional description hint from page metadata */
  description?: string | null;
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
 * Formats the content focus section for prompts.
 * Guides LLM to focus on actual content rather than platform descriptions.
 */
function formatContentFocus(): string {
  return `## CONTENT FOCUS
- Focus on the SPECIFIC CONTENT of this page (the article, post, thread, or message)
- Do NOT describe what the platform is or how it works (e.g., don't explain "LinkedIn is a professional network" or "Threads is a social media app")
- Do NOT include platform structural information (usernames, profile details, navigation elements)
- Summarize WHAT is being said, not WHO said it or WHERE it was posted`;
}

function normalizeHint(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function formatHintSection(
  input: Pick<SummaryPromptInput, 'url' | 'title' | 'description'>
): string {
  const hints: string[] = [];

  const url = normalizeHint(input.url);
  const title = normalizeHint(input.title);
  const description = normalizeHint(input.description);

  if (url !== undefined) {
    hints.push(`- URL: ${url}`);
  }
  if (title !== undefined) {
    hints.push(`- Title hint: ${title}`);
  }
  if (description !== undefined) {
    hints.push(`- Description hint: ${description}`);
  }

  if (hints.length === 0) {
    return '';
  }

  return `Use these hints to identify the main content:
${hints.join('\n')}`;
}

function formatMainContentSelection(
  input: Pick<SummaryPromptInput, 'url' | 'title' | 'description'>
): string {
  const hintSection = formatHintSection(input);

  return `## MAIN CONTENT SELECTION
First, silently identify the single primary content block of the page.
Then summarize only that primary content block.
- Do NOT assume the first paragraphs are the main content
- The extraction may begin with irrelevant site chrome
- Ignore completely: cookie/privacy banners, login/signup prompts, navigation, menus, headers, footers, app download prompts, ads, share widgets, and related or recommended sections
- Prefer the longest contiguous section whose topic matches the URL/title/description hints
- For job pages, summarize the actual job posting and role details, not the platform UI
- If multiple sections exist, choose the most information-dense section and ignore the rest
${hintSection.length > 0 ? `\n${hintSection}` : ''}

## BAD OUTPUT EXAMPLE
Bad: "LinkedIn uses cookies and asks you to sign in."

## GOOD OUTPUT EXAMPLE
Good: "SEEKR is hiring an AI Engineer in London with responsibilities across applied AI systems."`;
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
  version: '2.0.0',

  build(input: SummaryPromptInput, deps?: SummaryPromptDeps): string {
    const wordsPerMinute = deps?.wordsPerMinute ?? 200;
    const maxWords = input.maxReadingMinutes * wordsPerMinute;

    return `## Your Task
Summarize the following web page content.

${formatContentFocus()}

${formatMainContentSelection(input)}

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
  version: '2.0.0',

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

${formatContentFocus()}

${formatMainContentSelection(input)}

${formatRequirements(maxSentences, maxWords)}

${formatOutputFormat()}

---

## Original Content to Summarize
"""
${truncatedContent}
"""
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
