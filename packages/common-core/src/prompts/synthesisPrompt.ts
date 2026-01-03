/**
 * Shared synthesis prompt builder for combining multiple LLM research reports.
 * Used by adapters in llm-orchestrator to synthesize research from multiple providers.
 */

export interface SynthesisReport {
  model: string;
  content: string;
}

export interface ExternalReport {
  content: string;
  model?: string;
}

/**
 * Builds a structured synthesis prompt for combining research from multiple LLM models.
 * Handles both internal system reports and optional external reports.
 */
export function buildSynthesisPrompt(
  originalPrompt: string,
  reports: SynthesisReport[],
  externalReports?: ExternalReport[]
): string {
  const formattedReports = reports.map((r) => `### ${r.model}\n\n${r.content}`).join('\n\n---\n\n');

  let externalReportsSection = '';
  if (externalReports !== undefined && externalReports.length > 0) {
    const formattedExternal = externalReports
      .map((report, idx) => {
        const source = report.model ?? 'unknown source';
        return `### External Report ${String(idx + 1)} (${source})\n\n${report.content}`;
      })
      .join('\n\n---\n\n');
    externalReportsSection = `## External LLM Reports

The following reports were obtained from external LLM sources not available through system APIs:

${formattedExternal}

---

`;
  }

  const hasExternal = externalReports !== undefined && externalReports.length > 0;
  const conflictGuidelines = hasExternal
    ? `
## Conflict Resolution Guidelines

When information conflicts between system reports and external reports:
1. Note the discrepancy explicitly
2. Present both perspectives with attribution
3. If dates are available, prefer more recent information
4. Never silently discard conflicting data
`
    : '';

  return `You are a research analyst. Below are research reports from multiple AI models responding to the same prompt. Synthesize them into a comprehensive, well-organized report.

## Original Research Prompt

${originalPrompt}

${externalReportsSection}## System Reports

${formattedReports}
${conflictGuidelines}
## Your Task

Create a unified synthesis that:
1. **Begin with source attribution**: Start your synthesis with "This synthesis is based on research by: ${reports.map((r) => r.model).join(', ')}${hasExternal ? ` and external sources: ${externalReports.map((r, i) => r.model ?? `External ${String(i + 1)}`).join(', ')}` : ''}."
2. Combines the best insights from all reports${hasExternal ? ' (both system and external)' : ''}
3. Notes any conflicting information with clear attribution
4. Provides a balanced conclusion
5. Lists key sources from across all reports

## CRITICAL REQUIREMENTS
- Write the ENTIRE synthesis in the SAME LANGUAGE as the Original Research Prompt above (Polish prompt → Polish synthesis, Spanish prompt → Spanish synthesis, etc.)
- Format ALL source URLs as clickable markdown links: [descriptive text](URL)
- Preserve all URLs and citations from source reports

Write in clear, professional prose.`;
}
