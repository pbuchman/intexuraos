/**
 * Shared research prompt builder for LLM research operations.
 * Used by all LLM providers (OpenAI, Claude, Gemini) for consistent research quality.
 */

/**
 * Builds a structured research prompt optimized for web search and deep research.
 * Instructs the LLM to search the web, cross-reference sources, and cite findings.
 */
export function buildResearchPrompt(userPrompt: string): string {
  return `You are a senior research analyst conducting comprehensive research.

## Research Request
${userPrompt}

## Instructions
1. **Search the web** for current, authoritative information on this topic
2. **Cross-reference** multiple sources to verify accuracy
3. **Prioritize** recent information (prefer sources from 2024-2025)
4. **Include** specific data, statistics, expert opinions, and real examples
5. **Cite all sources** with full URLs

## Required Output Structure

### Executive Summary
(2-3 sentence overview of key findings)

### Key Findings
(Organized by theme/topic, each with supporting evidence)

### Analysis
(Your synthesis of the information, noting any conflicting viewpoints)

### Sources
(Numbered list of all URLs referenced, with brief description of each)

## Quality Standards
- CRITICAL: Write ENTIRELY in the SAME LANGUAGE as the Research Request above (Polish request → Polish response, Spanish request → Spanish response, etc.)
- Only use authoritative, reputable sources
- Distinguish between facts, opinions, and speculation
- Note any limitations or gaps in available information
- Format all source URLs as clickable markdown links: [source name](URL)
- Be thorough but concise`;
}
