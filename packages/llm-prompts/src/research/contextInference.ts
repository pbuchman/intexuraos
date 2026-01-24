/**
 * Prompt builder for inferring research context from a user query.
 */

import type { InferResearchContextOptions } from './contextTypes.js';

function getDatePart(isoString: string): string {
  return isoString.split('T')[0] as string;
}

export function buildInferResearchContextPrompt(
  userQuery: string,
  opts?: InferResearchContextOptions
): string {
  const asOfDate = opts?.asOfDate ?? getDatePart(new Date().toISOString());
  const defaultCountry = opts?.defaultCountryOrRegion ?? 'United States';
  const defaultJurisdiction = opts?.defaultJurisdiction ?? 'United States';
  const defaultCurrency = opts?.defaultCurrency ?? 'USD';
  const prefersRecentYears = opts?.prefersRecentYears ?? 2;

  return `You are a query analyzer. Analyze the user's research query and output a JSON context object.

USER QUERY:
"""
${userQuery}
"""

ANALYSIS INSTRUCTIONS:
1. Detect the language the user wrote in (output in that same language where applicable)
2. Identify the domain category
3. Determine the mode (compact for quick answers, standard for detailed research, audit for exhaustive analysis)
4. Summarize the user's intent
5. Identify what defaults you're applying and why
6. List assumptions you're making
7. Determine the preferred answer style(s)
8. Set time scope based on query context
9. Set locale scope based on any geographic indicators
10. Create a research plan with key questions and search queries
11. Determine output format preferences from the query
12. Assess safety considerations
13. Flag any red flags or concerns

DEFAULTS (record in defaults_applied if used):
- as_of_date: "${asOfDate}"
- country_or_region: "${defaultCountry}"
- jurisdiction: "${defaultJurisdiction}"
- currency: "${defaultCurrency}"
- prefers_recent_years: ${String(prefersRecentYears)}

DOMAIN OPTIONS:
travel, product, technical, legal, medical, financial, security_privacy, business_strategy, marketing_sales, hr_people_ops, education_learning, science_research, history_culture, politics_policy, real_estate, food_nutrition, fitness_sports, entertainment_media, diy_home, general, unknown

MODE RULES:
- "compact": User wants quick, direct answer (keywords: "quickly", "briefly", "just tell me")
- "standard": Default for most research queries
- "audit": User wants exhaustive analysis (keywords: "comprehensive", "deep dive", "everything about")

ANSWER_STYLE OPTIONS (can include multiple):
- practical: Focus on actionable advice
- evidence_first: Prioritize citations and sources
- step_by_step: Numbered sequential instructions
- executive: High-level summary for decision-makers
- checklist: Itemized list format

PREFERRED_SOURCE_TYPES OPTIONS:
official, primary_docs, regulators, manufacturers, academic, reputable_media, community

AVOID_SOURCE_TYPES OPTIONS:
random_blogs, seo_farms, unknown_affiliates

OUTPUT STRICT JSON (no markdown, no explanation):
{
  "language": "<detected language code, e.g., 'en', 'he', 'es'>",
  "domain": "<one of the domain options>",
  "mode": "<compact|standard|audit>",
  "intent_summary": "<1-2 sentence summary of what user wants>",
  "defaults_applied": [
    {"key": "<field name>", "value": "<value used>", "reason": "<why this default was applied>"}
  ],
  "assumptions": ["<assumption 1>", "<assumption 2>"],
  "answer_style": ["<style1>", "<style2>"],
  "time_scope": {
    "as_of_date": "<YYYY-MM-DD>",
    "prefers_recent_years": <number>,
    "is_time_sensitive": <boolean>
  },
  "locale_scope": {
    "country_or_region": "<country or region>",
    "jurisdiction": "<legal jurisdiction>",
    "currency": "<currency code>"
  },
  "research_plan": {
    "key_questions": ["<question 1>", "<question 2>", "<question 3>"],
    "search_queries": ["<search query 1>", "<search query 2>"],
    "preferred_source_types": ["<source type 1>", "<source type 2>"],
    "avoid_source_types": ["<avoid type 1>"]
  },
  "output_format": {
    "wants_table": <boolean>,
    "wants_steps": <boolean>,
    "wants_pros_cons": <boolean>,
    "wants_budget_numbers": <boolean>
  },
  "safety": {
    "high_stakes": <boolean>,
    "required_disclaimers": ["<disclaimer if needed>"]
  },
  "red_flags": ["<any concerns about the query>"]
}`;
}
