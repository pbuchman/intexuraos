/**
 * Repair prompt builder for research context inference.
 * When initial LLM response fails schema validation, this builds a repair prompt.
 */

export function buildResearchContextRepairPrompt(
  originalQuery: string,
  invalidResponse: string,
  errorMessage: string
): string {
  return `The previous response was invalid. Please fix it.

USER QUERY:
"""
${originalQuery}
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
  "language": "<string, e.g. 'en', 'he', 'es'>",
  "domain": "<string: travel|product|technical|legal|medical|financial|security_privacy|business_strategy|marketing_sales|hr_people_ops|education_learning|science_research|history_culture|politics_policy|real_estate|food_nutrition|fitness_sports|entertainment_media|diy_home|general|unknown>",
  "mode": "<string: compact|standard|audit>",
  "intent_summary": "<string summary>",
  "defaults_applied": [
    {"key": "<string>", "value": "<string>", "reason": "<string>"}
  ],
  "assumptions": ["<string>", "..."],
  "answer_style": ["<string: practical|evidence_first|step_by_step|executive|checklist>", "..."],
  "time_scope": {
    "as_of_date": "<string: YYYY-MM-DD>",
    "prefers_recent_years": <number>,
    "is_time_sensitive": <boolean>
  },
  "locale_scope": {
    "country_or_region": "<string>",
    "jurisdiction": "<string>",
    "currency": "<string: USD|EUR|GBP|etc>"
  },
  "research_plan": {
    "key_questions": ["<string>", "..."],
    "search_queries": ["<string>", "..."],
    "preferred_source_types": ["<string: official|primary_docs|regulators|manufacturers|academic|reputable_media|community>", "..."],
    "avoid_source_types": ["<string: random_blogs|seo_farms|unknown_affiliates>", "..."]
  },
  "output_format": {
    "wants_table": <boolean>,
    "wants_steps": <boolean>,
    "wants_pros_cons": <boolean>,
    "wants_budget_numbers": <boolean>
  },
  "safety": {
    "high_stakes": <boolean>,
    "required_disclaimers": ["<string>", "..."]
  },
  "red_flags": ["<string>", "..."]
}

Output the corrected JSON:`;
}
