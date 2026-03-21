/**
 * Description builder for Linear issues.
 * Constructs structured markdown descriptions from extracted issue data.
 */

import type { ExtractedIssueData } from './models.js';

/**
 * Build structured markdown description from extracted data.
 * Always includes the original user instruction at the top.
 * Section order: Original User Instruction > Key Points (if summary) > Functional Requirements > Technical Details
 */
export function buildIssueDescription(
  extracted: ExtractedIssueData,
  originalText: string,
  summary?: string
): string {
  const sections: string[] = [];

  sections.push(
    `## Original User Instruction\n\n> ${originalText}\n\n_This is the original user instruction, transcribed verbatim. May include typos but preserves original observations._`
  );

  if (summary !== undefined) {
    sections.push(`## Key Points\n\n${summary}`);
  }

  if (extracted.functionalRequirements !== null) {
    sections.push(`## Functional Requirements\n\n${extracted.functionalRequirements}`);
  }

  if (extracted.technicalDetails !== null) {
    sections.push(`## Technical Details\n\n${extracted.technicalDetails}`);
  }

  return sections.join('\n\n');
}
