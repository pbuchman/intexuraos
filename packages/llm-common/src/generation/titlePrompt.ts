/**
 * Title generation prompt for creating concise titles from content.
 * Consolidates title generation used across research-agent and data-insights.
 */

import type { PromptBuilder, PromptDeps } from '../shared/types.js';

export interface TitlePromptInput {
  /** The content to generate a title for (research prompt or data source content) */
  content: string;
}

export interface TitlePromptDeps extends PromptDeps {
  /** Maximum character length for the title */
  maxLength?: number;
  /** Word count range (for research titles) */
  wordRange?: { min: number; max: number };
  /** Include good/bad examples in prompt */
  includeExamples?: boolean;
  /** Content preview limit (truncate long content) */
  contentPreviewLimit?: number;
}

const GOOD_EXAMPLES = `GOOD EXAMPLES:
- "Gran Canaria w Drugiej Połowie Stycznia" (for Polish prompt about Gran Canaria)
- "Machine Learning in Healthcare Applications" (for English prompt)
- "Paris Budget Travel Guide" (for English prompt)`;

const BAD_EXAMPLES = `BAD EXAMPLES (DO NOT DO THIS):
- "Here are a few options: 1. Gran Canaria January Trip: Worth it? (9 words)"
- "Title: Planning Your Gran Canaria Vacation in January"
- "Gran Canaria January Tourist Guide: What to See, Do, Stay. (10 words)"`;

export const titlePrompt: PromptBuilder<TitlePromptInput, TitlePromptDeps> = {
  name: 'title-generation',
  description: 'Generates concise titles from content or research prompts',

  build(input: TitlePromptInput, deps?: TitlePromptDeps): string {
    const contentPreviewLimit = deps?.contentPreviewLimit ?? 5000;
    const contentPreview =
      input.content.length > contentPreviewLimit
        ? input.content.slice(0, contentPreviewLimit) + '...'
        : input.content;

    const wordRange = deps?.wordRange ?? { min: 5, max: 8 };
    const maxLength = deps?.maxLength;
    const includeExamples = deps?.includeExamples ?? false;

    const lengthRequirements: string[] = [];
    lengthRequirements.push(
      `- Title must be ${String(wordRange.min)}-${String(wordRange.max)} words maximum`
    );
    if (maxLength !== undefined) {
      lengthRequirements.push(`- Maximum ${String(maxLength)} characters`);
    }

    const examplesSection = includeExamples ? `\n${GOOD_EXAMPLES}\n\n${BAD_EXAMPLES}\n` : '';

    return `Generate a short, concise title for this content.

CRITICAL REQUIREMENTS:
${lengthRequirements.join('\n')}
- Title must be in the SAME LANGUAGE as the content (Polish → Polish title, English → English title)
- Return ONLY the title - no explanations, no options, no word counts
- Do NOT start with "Here are options" or similar phrases
- Be specific and descriptive
- Do not include quotes around the title
${examplesSection}
Content:
${contentPreview}

Generate title:`;
  },
};
