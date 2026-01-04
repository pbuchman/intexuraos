/**
 * Shared synthesis prompt builder for combining multiple LLM research reports.
 * Used by adapters in llm-orchestrator to synthesize research from multiple providers.
 */

import type { SynthesisContext } from './context/types.js';

export interface SynthesisReport {
  model: string;
  content: string;
}

export interface AdditionalSource {
  content: string;
  label?: string;
}

/**
 * @deprecated Use AdditionalSource instead. Kept for backward compatibility.
 */
export type ExternalReport = AdditionalSource;

function buildSynthesisGoalsSection(ctx: SynthesisContext): string {
  const goalDescriptions: Record<string, string> = {
    merge: 'Combine complementary information from all sources into a unified narrative',
    dedupe: 'Remove duplicate information, keeping the most complete version',
    conflict_audit: 'Identify and explicitly analyze conflicting information between sources',
    rank_recommendations: 'Order recommendations by quality, relevance, and source authority',
    summarize: 'Condense the information into key actionable points',
  };

  return ctx.synthesis_goals
    .map(
      (goal) =>
        `- **${goal.replace(/_/g, ' ').toUpperCase()}**: ${goalDescriptions[goal] as string}`
    )
    .join('\n');
}

function buildConflictsSection(ctx: SynthesisContext): string {
  if (ctx.detected_conflicts.length === 0) {
    return '';
  }

  const conflictItems = ctx.detected_conflicts
    .map(
      (c) =>
        `- **${c.topic}** (${c.severity.toUpperCase()}): ${c.conflict_summary}\n  Sources: ${c.sources_involved.join(', ')}`
    )
    .join('\n');

  return `
## Detected Conflicts to Address

The following conflicts were identified between sources:
${conflictItems}

Address each conflict explicitly in your synthesis.`;
}

function buildMissingSectionsSection(ctx: SynthesisContext): string {
  if (ctx.missing_sections.length === 0) {
    return '';
  }

  return `
## Missing Coverage

The following topics were not adequately covered by the sources:
${ctx.missing_sections.map((s) => `- ${s}`).join('\n')}

Note these gaps in your synthesis.`;
}

function buildContextualSynthesisPrompt(
  originalPrompt: string,
  reports: SynthesisReport[],
  ctx: SynthesisContext,
  additionalSources?: AdditionalSource[]
): string {
  const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');

  let additionalSourcesSection = '';
  if (additionalSources !== undefined && additionalSources.length > 0) {
    const formattedSources = additionalSources
      .map((source, idx) => {
        const sourceLabel = source.label ?? `Source ${String(idx + 1)}`;
        return `### ${sourceLabel}\n\n${source.content}`;
      })
      .join('\n\n---\n\n');
    additionalSourcesSection = `## Additional Sources

The following additional context was provided by the user:

${formattedSources}

---

`;
  }

  const hasAdditionalSources = additionalSources !== undefined && additionalSources.length > 0;
  const modelsList = reports.map((r) => r.model).join(', ');
  const additionalSourcesList = hasAdditionalSources
    ? additionalSources.map((s, i) => s.label ?? `Source ${String(i + 1)}`).join(', ')
    : '';

  const sourcesInfo = hasAdditionalSources
    ? `- **LLM models**: ${modelsList}\n- **Additional sources**: ${additionalSourcesList}`
    : `- **LLM models**: ${modelsList}`;

  const safetySection =
    ctx.safety.high_stakes || ctx.safety.required_disclaimers.length > 0
      ? `
## Safety Considerations

${ctx.safety.high_stakes ? '⚠️ This is a HIGH-STAKES topic. Be extra careful with accuracy.\n' : ''}${ctx.safety.required_disclaimers.length > 0 ? `Include these disclaimers:\n${ctx.safety.required_disclaimers.map((d) => `- ${d}`).join('\n')}` : ''}`
      : '';

  const redFlagsSection =
    ctx.red_flags.length > 0
      ? `
## Concerns to Address

${ctx.red_flags.map((f) => `- ${f}`).join('\n')}`
      : '';

  const outputFormatSection =
    ctx.output_format.wants_table || ctx.output_format.wants_actionable_summary
      ? `
## Output Format

${ctx.output_format.wants_table ? '- Include comparison tables where appropriate\n' : ''}${ctx.output_format.wants_actionable_summary ? '- End with an actionable summary section' : ''}`
      : '';

  const introSuffix = hasAdditionalSources ? ' and additional context provided by the user' : '';

  return `Below are reports from multiple AI models${introSuffix}. Synthesize them into a comprehensive, well-organized report.

## Original Prompt

${originalPrompt}

## Sources Used

${sourcesInfo}

## Source Preference Strategy

- ${ctx.source_preference.prefer_official_over_aggregators ? 'Prefer official sources over aggregators when information conflicts' : 'Weight all sources equally'}
- ${ctx.source_preference.prefer_recent_when_time_sensitive ? 'Prefer more recent sources for time-sensitive information' : 'Consider all timeframes equally'}

${additionalSourcesSection}## LLM Reports

${formattedReports}

## Synthesis Goals

${buildSynthesisGoalsSection(ctx)}
${buildConflictsSection(ctx)}${buildMissingSectionsSection(ctx)}${safetySection}${redFlagsSection}${outputFormatSection}

## Your Task

Create a unified synthesis that:
1. **Mention sources**: Begin by acknowledging which sources were used
2. **Follow synthesis goals**: Apply the strategies listed above
3. **Handle conflicts**: Note any conflicting information with clear attribution
4. **Address gaps**: Acknowledge missing coverage areas
5. **Conclude**: Provide a balanced summary

## Citation Rules (CRITICAL)

- **Inline citations**: Include source links DIRECTLY in the paragraph where information is mentioned
- **Link text MUST describe the source**: Use [Official Government Site](URL), [Canary Tourism](URL), [Fishing Guide](URL)
- **NEVER use model names as link text**: Do NOT write [gemini-2.5-pro](URL) or [claude-sonnet](URL)
- **All URLs**: Format as clickable markdown links with descriptive text
- **Sources section**: Only list additional sources at the end if they weren't already cited inline

## Language Requirement

Write the ENTIRE synthesis in ${ctx.language.toUpperCase()}. This is the language of the original query.`;
}

/**
 * Builds a structured synthesis prompt for combining research from multiple LLM models.
 * Handles both LLM reports and optional additional sources provided by the user.
 *
 * @param originalPrompt - The original user query
 * @param reports - Array of LLM research reports to synthesize
 * @param ctxOrAdditionalSources - Optional synthesis context or additional sources (for backward compatibility)
 * @param additionalSources - Optional additional sources when context is provided
 */
export function buildSynthesisPrompt(
  originalPrompt: string,
  reports: SynthesisReport[],
  ctxOrAdditionalSources?: SynthesisContext | AdditionalSource[],
  additionalSources?: AdditionalSource[]
): string {
  if (
    ctxOrAdditionalSources !== undefined &&
    !Array.isArray(ctxOrAdditionalSources) &&
    'synthesis_goals' in ctxOrAdditionalSources
  ) {
    return buildContextualSynthesisPrompt(
      originalPrompt,
      reports,
      ctxOrAdditionalSources,
      additionalSources
    );
  }

  const legacyAdditionalSources = Array.isArray(ctxOrAdditionalSources)
    ? ctxOrAdditionalSources
    : undefined;

  const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');

  let additionalSourcesSection = '';
  if (legacyAdditionalSources !== undefined && legacyAdditionalSources.length > 0) {
    const formattedSources = legacyAdditionalSources
      .map((source, idx) => {
        const sourceLabel = source.label ?? `Source ${String(idx + 1)}`;
        return `### ${sourceLabel}\n\n${source.content}`;
      })
      .join('\n\n---\n\n');
    additionalSourcesSection = `## Additional Sources

The following additional context was provided by the user:

${formattedSources}

---

`;
  }

  const hasAdditionalSources =
    legacyAdditionalSources !== undefined && legacyAdditionalSources.length > 0;
  const conflictGuidelines = hasAdditionalSources
    ? `
## Conflict Resolution Guidelines

When information conflicts between any sources:
1. Note the discrepancy explicitly
2. Present both perspectives with attribution
3. If dates are available, prefer more recent information
4. Never silently discard conflicting data
`
    : '';

  const modelsList = reports.map((r) => r.model).join(', ');
  const additionalSourcesList = hasAdditionalSources
    ? legacyAdditionalSources.map((s, i) => s.label ?? `Source ${String(i + 1)}`).join(', ')
    : '';

  const sourcesInfo = hasAdditionalSources
    ? `- **LLM models**: ${modelsList}\n- **Additional sources**: ${additionalSourcesList}`
    : `- **LLM models**: ${modelsList}`;

  const introSuffix = hasAdditionalSources ? ' and additional context provided by the user' : '';
  return `Below are reports from multiple AI models${introSuffix}. Synthesize them into a comprehensive, well-organized report.

## Original Prompt

${originalPrompt}

## Sources Used

${sourcesInfo}

${additionalSourcesSection}## LLM Reports

${formattedReports}
${conflictGuidelines}
## Your Task

Create a unified synthesis that:
1. **Mention sources**: Begin by acknowledging which sources were used
2. **Combine insights**: Merge the best information from all sources${hasAdditionalSources ? ' (both LLM reports and additional sources)' : ''}
3. **Handle conflicts**: Note any conflicting information with clear attribution
4. **Conclude**: Provide a balanced summary

## Adaptive Behavior

Adjust your synthesis style based on the topic:
- **Travel/lifestyle**: Highlight practical recommendations, include booking tips
- **Technical/programming**: Preserve code examples, focus on accuracy
- **Medical/health**: Add disclaimers, prioritize consensus from medical sources
- **Legal/financial**: Note jurisdiction limitations, recommend professional advice
- **Comparison requests**: Use tables or structured pros/cons format
- **Other topics**: Balanced synthesis with appropriate depth for the subject

## Citation Rules (CRITICAL)

- **Inline citations**: Include source links DIRECTLY in the paragraph where information is mentioned. Example: "The Teide volcano is Spain's highest peak ([Canary Tourism](https://example.com/teide))."
- **Link text MUST describe the source**: Use [Official Government Site](URL), [Canary Tourism](URL), [Fishing Guide](URL)
- **NEVER use model names as link text**: Do NOT write [gemini-2.5-pro](URL) or [claude-sonnet](URL)
- **All URLs**: Format as clickable markdown links with descriptive text
- **Sources section**: Only list additional sources at the end if they weren't already cited inline

## Language Requirement

Write the ENTIRE synthesis in the SAME LANGUAGE as the Original Prompt (Polish → Polish, Spanish → Spanish, etc.)`;
}
