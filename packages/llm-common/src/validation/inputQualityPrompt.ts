/**
 * Input quality validation prompt for research prompts.
 * Evaluates prompt quality on a 0-2 scale.
 */

import type { PromptBuilder, PromptDeps } from '../types.js';

export interface InputQualityPromptInput {
  /** The research prompt to evaluate */
  prompt: string;
}

export interface InputQualityPromptDeps extends PromptDeps {}

export const inputQualityPrompt: PromptBuilder<
  InputQualityPromptInput,
  InputQualityPromptDeps
> = {
  name: 'input-quality-validation',
  description: 'Validates research prompt quality and returns quality score with reason',

  build(input: InputQualityPromptInput): string {
    return `You are a research prompt quality analyzer. Evaluate the following research prompt.

QUALITY SCALE:
- INVALID (0): Too vague, nonsensical, or impossible to research. Examples: "stuff", "???", single word without context, gibberish
- WEAK_BUT_VALID (1): Understandable but could be significantly improved. Examples: "travel tips", "best phones", "how to lose weight"
- GOOD (2): Clear, specific, and well-formed. Examples: "Compare budget airlines flying from NYC to London in January 2025", "What are the key features to consider when buying a smartphone under $500 in 2025?"

EVALUATION CRITERIA:
1. Specificity: Does it include enough detail to guide research?
2. Clarity: Is the intent clear and unambiguous?
3. Scope: Is it focused enough to produce useful results?
4. Actionability: Can LLMs actually research this topic effectively?

IMPORTANT RULES:
- Respond with ONLY valid JSON (no markdown, no code blocks)
- The "reason" must be in the SAME LANGUAGE as the input prompt
- Keep "reason" under 20 words
- Be objective and consistent

INPUT PROMPT:
${input.prompt}

JSON RESPONSE:`;
  },
};
