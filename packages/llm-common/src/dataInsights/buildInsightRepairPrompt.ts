/**
 * Repair prompt builder for data insight analysis.
 * When initial LLM response fails validation, this builds a repair prompt.
 */

/**
 * Build a repair prompt for insight analysis.
 *
 * Used when analyzeData() receives an invalid LLM response
 * (e.g., description has too many sentences, invalid chart type, malformed format).
 */
export function buildInsightRepairPrompt(
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
1. Output ONLY the corrected insight lines
2. Each insight MUST follow this EXACT format on a SINGLE line:
   INSIGHT_N: Title=<title>; Description=<2-3 sentences>; Trackable=<metric>; ChartType=<C1-C6>
3. Description should be 2-3 sentences, maximum 6 sentences allowed
4. ChartType must be exactly one of: C1, C2, C3, C4, C5, C6
5. No additional text, explanations, or formatting
6. Each INSIGHT line must be on its own line
7. If no insights are possible, use: NO_INSIGHTS: Reason=<explanation>

EXAMPLES OF VALID OUTPUT:
INSIGHT_1: Title=Monthly Revenue Growth; Description=Revenue increased by 15% month-over-month. This indicates strong market demand.; Trackable=Monthly revenue in USD; ChartType=C2
INSIGHT_2: Title=User Retention Rate; Description=User retention improved from 60% to 75%. Engagement features are working effectively.; Trackable=Percentage of returning users; ChartType=C1

EXAMPLES OF INVALID OUTPUT:
- Description with 7+ sentences (must be max 6)
- ChartType=Bar (must use C1-C6 codes)
- Lines split across multiple lines
- Extra explanation text before or after insights

Output the corrected insight lines:`;
}
