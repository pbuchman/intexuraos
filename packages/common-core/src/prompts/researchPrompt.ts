/**
 * Shared research prompt builder for LLM research operations.
 * Used by all LLM providers (OpenAI, Claude, Gemini) for consistent research quality.
 */

import type { ResearchContext } from './context/types.js';

function buildDomainGuidelines(ctx: ResearchContext): string {
  const domainGuides: Record<string, string> = {
    travel:
      'Include practical recommendations, booking links, local tips, transportation options, and seasonal considerations.',
    product:
      'Compare features objectively, include pricing, cite manufacturer specs, highlight user reviews.',
    technical:
      'Use precise definitions, include code examples when relevant, cite official documentation.',
    legal:
      'Provide general information only, recommend professional legal advice, cite jurisdictional differences.',
    medical:
      'Include clear disclaimers, cite peer-reviewed sources, never provide diagnosis, recommend consulting professionals.',
    financial:
      'Provide general information only, recommend professional financial advice, include risk disclaimers.',
    security_privacy:
      'Cite official security advisories, include best practices, note compliance requirements.',
    business_strategy: 'Include market data, competitive analysis, cite business publications.',
    marketing_sales: 'Include metrics, case studies, cite industry benchmarks.',
    hr_people_ops: 'Note legal compliance requirements, cite labor laws by jurisdiction.',
    education_learning:
      'Include pedagogical approaches, cite educational research, provide practical examples.',
    science_research:
      'Cite peer-reviewed papers, distinguish between established science and emerging research.',
    history_culture: 'Cite primary sources when available, note historiographical debates.',
    politics_policy:
      'Present multiple viewpoints, cite official government sources, distinguish fact from opinion.',
    real_estate: 'Include market data, note regional variations, cite local regulations.',
    food_nutrition:
      'Cite nutritional data, note dietary restrictions, include safety considerations.',
    fitness_sports: 'Include safety guidelines, cite sports science, note individual variation.',
    entertainment_media:
      'Include release dates, cite official sources, note regional availability.',
    diy_home: 'Include safety warnings, cite building codes, provide step-by-step guidance.',
    general: 'Provide balanced, factual information with appropriate depth.',
    unknown: 'Provide balanced, factual information with appropriate depth.',
  };

  return domainGuides[ctx.domain] as string;
}

function buildOutputFormatGuidelines(ctx: ResearchContext): string {
  const parts: string[] = [];
  if (ctx.output_format.wants_table) {
    parts.push('- Include comparison tables where appropriate');
  }
  if (ctx.output_format.wants_steps) {
    parts.push('- Provide numbered step-by-step instructions');
  }
  if (ctx.output_format.wants_pros_cons) {
    parts.push('- Include pros/cons analysis');
  }
  if (ctx.output_format.wants_budget_numbers) {
    parts.push('- Include specific budget figures and cost breakdowns');
  }
  return parts.length > 0 ? parts.join('\n') : '- Use the most appropriate format for the content';
}

function buildContextualResearchPrompt(userPrompt: string, ctx: ResearchContext): string {
  const safetySection =
    ctx.safety.high_stakes || ctx.safety.required_disclaimers.length > 0
      ? `
## Safety Considerations

${ctx.safety.high_stakes ? '⚠️ This is a HIGH-STAKES topic. Be extra careful with accuracy.\n' : ''}${ctx.safety.required_disclaimers.length > 0 ? `Include these disclaimers:\n${ctx.safety.required_disclaimers.map((d) => `- ${d}`).join('\n')}` : ''}`
      : '';

  const redFlagsSection =
    ctx.red_flags.length > 0
      ? `
## Research Concerns

Address these concerns identified in the query:
${ctx.red_flags.map((f) => `- ${f}`).join('\n')}`
      : '';

  const keyQuestions =
    ctx.research_plan.key_questions.length > 0
      ? `
## Key Questions to Answer

${ctx.research_plan.key_questions.map((q, i) => `${String(i + 1)}. ${q}`).join('\n')}`
      : '';

  return `Conduct comprehensive research on the following topic.

## Research Request

${userPrompt}

## Intent Summary

${ctx.intent_summary}
${keyQuestions}

## Domain Guidelines (${ctx.domain.toUpperCase()})

${buildDomainGuidelines(ctx)}

## Output Structure

If the Research Request contains its own structure (headings, bullet points, numbered questions), follow that structure.

Otherwise, organize by theme/topic with:
- **Overview**: 2-3 sentences summarizing key findings
- **Main Content**: Organized sections with supporting evidence
- **Summary**: Brief synthesis noting any conflicting viewpoints or gaps

## Output Format Preferences

${buildOutputFormatGuidelines(ctx)}

## Research Guidelines

- **Time scope**: Focus on sources from ${ctx.time_scope.as_of_date.substring(0, 4)} and ${String(ctx.time_scope.prefers_recent_years)} years prior${ctx.time_scope.is_time_sensitive ? ' (TIME-SENSITIVE: prefer most recent sources)' : ''}
- **Geographic focus**: ${ctx.locale_scope.country_or_region} (jurisdiction: ${ctx.locale_scope.jurisdiction}, currency: ${ctx.locale_scope.currency})
- **Source preferences**: ${ctx.research_plan.preferred_source_types.join(', ')}
- **Avoid**: ${ctx.research_plan.avoid_source_types.join(', ')}
- **Cross-reference** multiple sources to verify accuracy
- **Include specifics**: data, statistics, expert opinions, real examples
- **Distinguish** between facts, opinions, and speculation
${safetySection}${redFlagsSection}

## Citation Rules (CRITICAL)

- **Inline citations**: Include source links DIRECTLY in the paragraph where information is mentioned. Example: "The Teide volcano is Spain's highest peak ([Canary Tourism](https://example.com/teide))."
- **List items**: Each recommended place, product, or service must have its source linked inline
- **All URLs**: Format as clickable markdown links: [descriptive text](URL)
- **Sources section**: Only list additional sources at the end if they weren't already cited inline

## What NOT to Do

- Do NOT invent or hallucinate sources - if you can't find a source, say so
- Do NOT use outdated information when recent data is available
- Do NOT include sources you haven't actually accessed

## Language Requirement

Write the ENTIRE response in ${ctx.language.toUpperCase()}. This is the language of the original query.`;
}

/**
 * Builds a structured research prompt optimized for web search and deep research.
 * Instructs the LLM to search the web, cross-reference sources, and cite findings.
 *
 * @param userPrompt - The user's research query
 * @param ctx - Optional research context for targeted prompts
 */
export function buildResearchPrompt(userPrompt: string, ctx?: ResearchContext): string {
  if (ctx !== undefined) {
    return buildContextualResearchPrompt(userPrompt, ctx);
  }

  const currentYear = new Date().getFullYear();
  return `Conduct comprehensive research on the following topic.

## Research Request

${userPrompt}

## Output Structure

If the Research Request contains its own structure (headings, bullet points, numbered questions), follow that structure.

Otherwise, use this default structure:
- **Overview**: 2-3 sentences summarizing key findings
- **Main Content**: Organized by theme/topic with supporting evidence
- **Summary**: Brief synthesis noting any conflicting viewpoints or gaps

## Adaptive Behavior

Adjust your approach based on the topic:
- **Travel/lifestyle**: Practical recommendations, booking links, local tips
- **Technical/programming**: Precise definitions, code examples, official docs
- **Medical/health**: Clear disclaimers, cite medical sources, no diagnosis
- **Legal/financial**: General info only, recommend professional advice
- **Comparison requests**: Structured pros/cons, objective criteria
- **Other topics**: Balanced, factual approach with appropriate depth

## Research Guidelines

- **Prioritize recent sources** (prefer ${String(currentYear - 1)}-${String(currentYear)})
- **Cross-reference** multiple sources to verify accuracy
- **Include specifics**: data, statistics, expert opinions, real examples
- **Distinguish** between facts, opinions, and speculation

## Citation Rules (CRITICAL)

- **Inline citations**: Include source links DIRECTLY in the paragraph where information is mentioned. Example: "The Teide volcano is Spain's highest peak ([Canary Tourism](https://example.com/teide))."
- **List items**: Each recommended place, product, or service must have its source linked inline
- **All URLs**: Format as clickable markdown links: [descriptive text](URL)
- **Sources section**: Only list additional sources at the end if they weren't already cited inline

## What NOT to Do

- Do NOT invent or hallucinate sources - if you can't find a source, say so
- Do NOT use outdated information when recent data is available
- Do NOT include sources you haven't actually accessed

## Language Requirement

Write the ENTIRE response in the SAME LANGUAGE as the Research Request (Polish → Polish, Spanish → Spanish, etc.)`;
}
