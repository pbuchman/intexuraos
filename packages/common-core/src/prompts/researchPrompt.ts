/**
 * Shared research prompt builder for LLM research operations.
 * Used by all LLM providers (OpenAI, Claude, Gemini) for consistent research quality.
 */

/**
 * Builds a structured research prompt optimized for web search and deep research.
 * Instructs the LLM to search the web, cross-reference sources, and cite findings.
 */
export function buildResearchPrompt(userPrompt: string): string {
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
