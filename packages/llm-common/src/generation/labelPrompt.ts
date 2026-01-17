/**
 * Label generation prompt for creating short content labels.
 * Used to generate 3-6 word labels summarizing content for UI display.
 */

import type { PromptBuilder, PromptDeps } from '../shared/types.js';

export interface LabelPromptInput {
  /** The content to generate a label for */
  content: string;
}

export interface LabelPromptDeps extends PromptDeps {
  /** Word count range for the label */
  wordRange?: { min: number; max: number };
  /** Content preview limit (truncate long content) */
  contentPreviewLimit?: number;
}

export const labelPrompt: PromptBuilder<LabelPromptInput, LabelPromptDeps> = {
  name: 'label-generation',
  description: 'Generates short labels (3-6 words) summarizing content',

  build(input: LabelPromptInput, deps?: LabelPromptDeps): string {
    const contentPreviewLimit = deps?.contentPreviewLimit ?? 2000;
    const contentPreview =
      input.content.length > contentPreviewLimit
        ? input.content.slice(0, contentPreviewLimit) + '...'
        : input.content;

    const wordRange = deps?.wordRange ?? { min: 3, max: 6 };

    return `Generate a very short label (${String(wordRange.min)}-${String(wordRange.max)} words) summarizing the following content.

CRITICAL REQUIREMENTS:
- Label must be ${String(wordRange.min)}-${String(wordRange.max)} words maximum
- Label must be in the SAME LANGUAGE as the content
- Return ONLY the label - no explanations, no quotes
- Describe WHAT the content is about, not its format

GOOD EXAMPLES:
- "Gran Canaria trip itinerary"
- "Wymagania techniczne projektu"
- "Customer feedback survey results"
- "Analiza konkurencji rynkowej"

BAD EXAMPLES:
- "Document about travel plans for vacation" (too long)
- "Here is a label: Trip Planning" (includes extra text)
- "A PDF file" (describes format, not content)

Content:
${contentPreview}

Generate label:`;
  },
};
