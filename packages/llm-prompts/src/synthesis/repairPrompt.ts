/**
 * Repair prompt builder for synthesis context inference.
 * When initial LLM response fails schema validation, this builds a repair prompt.
 */

export function buildSynthesisContextRepairPrompt(
  params: {
    originalPrompt: string;
    reports: { model: string; content: string }[];
    additionalSources: { content: string; label?: string }[];
  },
  invalidResponse: string,
  errorMessage: string
): string {
  return `The previous response was invalid. Please fix it.

ORIGINAL QUERY:
"""
${params.originalPrompt}
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
3. Booleans must be true or false (lowercase)
4. Arrays must use square brackets []
5. Objects must use curly braces {}
6. No trailing commas
7. No comments in JSON

EXPECTED SCHEMA:
{
  "language": "<string language code>",
  "domain": "<string: travel|product|technical|legal|medical|financial|security_privacy|business_strategy|marketing_sales|hr_people_ops|education_learning|science_research|history_culture|politics_policy|real_estate|food_nutrition|fitness_sports|entertainment_media|diy_home|general|unknown>",
  "mode": "<string: compact|standard|audit>",
  "synthesis_goals": ["<string: merge|dedupe|conflict_audit|rank_recommendations|summarize>", "..."],
  "missing_sections": ["<string topic not covered>", "..."],
  "detected_conflicts": [
    {
      "topic": "<string>",
      "sources_involved": ["<string model name>", "..."],
      "conflict_summary": "<string description>",
      "severity": "<string: low|medium|high>"
    }
  ],
  "source_preference": {
    "prefer_official_over_aggregators": <boolean>,
    "prefer_recent_when_time_sensitive": <boolean>
  },
  "defaults_applied": [
    {"key": "<string>", "value": "<string>", "reason": "<string>"}
  ],
  "assumptions": ["<string>", "..."],
  "output_format": {
    "wants_table": <boolean>,
    "wants_actionable_summary": <boolean>
  },
  "safety": {
    "high_stakes": <boolean>,
    "required_disclaimers": ["<string>", "..."]
  },
  "red_flags": ["<string>", "..."]
}

Output the corrected JSON:`;
}
