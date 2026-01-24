/**
 * Repair prompt builders for input validation.
 * When initial LLM response fails validation, these build repair prompts.
 */

/**
 * Build a repair prompt for input quality validation.
 *
 * Used when validateInput() receives an invalid LLM response.
 */
export function buildValidationRepairPrompt(
  originalPrompt: string,
  invalidResponse: string,
  errorMessage: string
): string {
  return `The previous response was invalid. Please fix it.

ORIGINAL PROMPT:
"""
${originalPrompt}
"""

ERROR DETAILS:
${errorMessage}

INVALID RESPONSE:
"""
${invalidResponse}
"""

REQUIREMENTS:
1. Output ONLY valid JSON (no markdown code blocks, no explanation text)
2. All string values must be in double quotes
3. The quality field must be a number (0, 1, or 2) - NOT a string
4. No trailing commas
5. No comments in JSON

EXPECTED SCHEMA:
{
  "quality": "<number: 0 (poor), 1 (okay), 2 (good)>",
  "reason": "<string explanation for the quality score>"
}

EXAMPLES:
{
  "quality": 2,
  "reason": "The prompt is clear, specific, and well-structured for research."
}

{
  "quality": 0,
  "reason": "The prompt is too vague and lacks specific criteria for investigation."
}

Output the corrected JSON:`;
}

/**
 * Build a repair prompt for input improvement.
 *
 * Used when improveInput() receives an invalid LLM response
 * (e.g., includes explanations, JSON formatting, or unwanted prefixes).
 */
export function buildImprovementRepairPrompt(
  originalPrompt: string,
  invalidResponse: string,
  errorMessage: string
): string {
  return `The previous response was invalid. Please fix it.

ORIGINAL PROMPT:
"""
${originalPrompt}
"""

ERROR DETAILS:
${errorMessage}

INVALID RESPONSE:
"""
${invalidResponse}
"""

REQUIREMENTS:
1. Return ONLY the improved prompt text
2. NO JSON format - just plain text
3. NO markdown code blocks
4. NO explanations, NO quotes around the text
5. NO prefixes like "Improved:", "Here is:", "Result:"
6. NO options or variations - just ONE improved version
7. Must be in the SAME LANGUAGE as the original
8. Keep it concise but comprehensive (ideally one clear sentence)

WHAT MAKES A GOOD IMPROVED PROMPT:
- Adds specificity (timeframes, geographic scope, specific criteria)
- Adds clarity to ambiguous terms
- Structures as a clear research question or directive
- Preserves the original intent and language

Output ONLY the improved prompt text:`;
}
