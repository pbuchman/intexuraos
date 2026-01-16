/**
 * Prompt builder for inferring synthesis context from LLM reports.
 */

import type { InferSynthesisContextParams } from './contextTypes.js';

function getDatePart(isoString: string): string {
  return isoString.split('T')[0] as string;
}

export function buildInferSynthesisContextPrompt(params: InferSynthesisContextParams): string {
  const { originalPrompt, reports = [], additionalSources = [] } = params;
  const asOfDate = params.asOfDate ?? getDatePart(new Date().toISOString());
  const defaultJurisdiction = params.defaultJurisdiction ?? 'United States';
  const defaultCurrency = params.defaultCurrency ?? 'USD';

  const reportsSection =
    reports.length > 0
      ? reports.map((r) => `=== ${r.model} ===\n${r.content}`).join('\n\n')
      : '(No LLM reports provided)';

  const sourcesSection =
    additionalSources.length > 0
      ? additionalSources
          .map(
            (s, i) =>
              `=== Source ${String(i + 1)}${s.label !== undefined ? `: ${s.label}` : ''} ===\n${s.content}`
          )
          .join('\n\n')
      : '';

  return `You are a synthesis analyzer. Analyze the original query and multiple LLM research reports to prepare for synthesis.

ORIGINAL USER QUERY:
"""
${originalPrompt}
"""

LLM RESEARCH REPORTS:
${reportsSection}
${sourcesSection.length > 0 ? `\nADDITIONAL SOURCES:\n${sourcesSection}` : ''}

ANALYSIS INSTRUCTIONS:
1. Detect the primary language used across reports
2. Identify the domain from the content
3. Determine synthesis mode based on query complexity
4. Identify synthesis goals (what needs to be done with these reports)
5. Find missing sections that weren't covered by any report
6. Detect conflicts between sources (different facts, recommendations, or conclusions)
7. Determine source preference strategy
8. Record defaults applied and assumptions made
9. Determine output format based on query and report content
10. Assess safety considerations
11. Flag any concerns

DEFAULTS (record in defaults_applied if used):
- as_of_date: "${asOfDate}"
- jurisdiction: "${defaultJurisdiction}"
- currency: "${defaultCurrency}"

DOMAIN OPTIONS:
travel, product, technical, legal, medical, financial, security_privacy, business_strategy, marketing_sales, hr_people_ops, education_learning, science_research, history_culture, politics_policy, real_estate, food_nutrition, fitness_sports, entertainment_media, diy_home, general, unknown

SYNTHESIS_GOALS OPTIONS (include all that apply):
- merge: Combine information from multiple sources
- dedupe: Remove duplicate information
- conflict_audit: Highlight and analyze conflicting information
- rank_recommendations: Order recommendations by relevance/quality
- summarize: Condense into key points

CONFLICT SEVERITY:
- low: Minor discrepancies that don't affect conclusions
- medium: Notable differences that should be mentioned
- high: Major contradictions that must be addressed

OUTPUT STRICT JSON (no markdown, no explanation):
{
  "language": "<detected primary language code>",
  "domain": "<one of the domain options>",
  "mode": "<compact|standard|audit>",
  "synthesis_goals": ["<goal1>", "<goal2>"],
  "missing_sections": ["<topic not covered>", "<another missing topic>"],
  "detected_conflicts": [
    {
      "topic": "<what the conflict is about>",
      "sources_involved": ["<model1>", "<model2>"],
      "conflict_summary": "<brief description of the conflict>",
      "severity": "<low|medium|high>"
    }
  ],
  "source_preference": {
    "prefer_official_over_aggregators": <boolean>,
    "prefer_recent_when_time_sensitive": <boolean>
  },
  "defaults_applied": [
    {"key": "<field name>", "value": "<value used>", "reason": "<why applied>"}
  ],
  "assumptions": ["<assumption 1>"],
  "output_format": {
    "wants_table": <boolean>,
    "wants_actionable_summary": <boolean>
  },
  "safety": {
    "high_stakes": <boolean>,
    "required_disclaimers": ["<disclaimer if needed>"]
  },
  "red_flags": ["<any concerns>"]
}`;
}
