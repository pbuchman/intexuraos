/**
 * Input improvement prompt for research prompts.
 * Improves prompt quality while preserving intent and language.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface InputImprovementPromptInput {
  /** The research prompt to improve */
  prompt: string;
}

export type InputImprovementPromptDeps = PromptDeps;

export const inputImprovementPrompt: PromptBuilder<InputImprovementPromptInput> = {
  name: 'input-improvement',
  description: 'Improves a research prompt while preserving intent and language',

  build(input: InputImprovementPromptInput): string {
    return `You are a research prompt improvement specialist. Improve the following research prompt.

REQUIREMENTS:
1. Preserve the ORIGINAL LANGUAGE - if input is Polish, output must be Polish; if English, output must be English
2. Preserve the ORIGINAL INTENT - don't change what the user wants to research
3. Add specificity, clarity, and focus to make it suitable for comprehensive research
4. Keep it concise but comprehensive (ideally one clear sentence)
5. Make it actionable for multi-LLM research

IMPROVEMENTS TO MAKE:
- Add relevant timeframes if applicable (e.g., "in 2025", "for next summer")
- Add geographic scope if relevant (e.g., "in Europe", "from NYC")
- Clarify ambiguous terms with specific criteria
- Add specific aspects to investigate (e.g., "comparing price, features, and reliability")
- Structure as a clear research question or directive

CRITICAL RULES:
- Return ONLY the improved prompt text
- NO explanations, NO quotes, NO prefixes like "Improved:" or "Here is:"
- NO options or variations - just ONE improved version
- Must be in the SAME LANGUAGE as the original

ORIGINAL PROMPT:
${input.prompt}

IMPROVED PROMPT:`;
  },
};
