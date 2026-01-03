/**
 * Shared synthesis prompt builder for combining multiple LLM research reports.
 * Used by adapters in llm-orchestrator to synthesize research from multiple providers.
 */

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

/**
 * Builds a structured synthesis prompt for combining research from multiple LLM models.
 * Handles both LLM reports and optional additional sources provided by the user.
 */
export function buildSynthesisPrompt(
  originalPrompt: string,
  reports: SynthesisReport[],
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
    ? additionalSources.map((s, i) => s.label ?? `Source ${String(i + 1)}`).join(', ')
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
- **List items**: Each recommended place, product, or service must have its source linked inline
- **All URLs**: Format as clickable markdown links: [descriptive text](URL)
- **Sources section**: Only list additional sources at the end if they weren't already cited inline

## Language Requirement

Write the ENTIRE synthesis in the SAME LANGUAGE as the Original Prompt (Polish → Polish, Spanish → Spanish, etc.)`;
}
