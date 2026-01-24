/**
 * Attribution system for synthesis output.
 * Provides types and functions for parsing, validating, and generating source attribution.
 */

/**
 * Source identifier format: S1, S2, ... for LLM reports; U1, U2, ... for user sources
 */
export type SourceId = `S${number}` | `U${number}`;

/**
 * Entry in the source map built from reports and additionalSources
 */
export interface SourceMapItem {
  id: SourceId;
  kind: 'llm' | 'user';
  displayName: string;
}

/**
 * Parsed Attribution line from synthesis output
 * Example: Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false
 */
export interface AttributionLine {
  primary: SourceId[];
  secondary: SourceId[];
  constraints: SourceId[];
  unk: boolean;
}

/**
 * A parsed section from the synthesis markdown
 */
export interface ParsedSection {
  title: string;
  level: number;
  attribution: AttributionLine | null;
  startLine: number;
  endLine: number;
}

/**
 * Result of validating attributions in synthesis output
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Entry in the generated breakdown scorecard
 */
export interface BreakdownEntry {
  id: SourceId;
  name: string;
  primaryCount: number;
  secondaryCount: number;
  constraintsCount: number;
  score: number;
  usedFor: {
    primary: string[];
    secondary: string[];
    constraints: string[];
  };
}

/**
 * Parse an Attribution line from synthesis output.
 * Returns null if the line is malformed or doesn't match expected format.
 *
 * @example
 * parseAttributionLine('Attribution: Primary=S1,S2; Secondary=U1; Constraints=; UNK=false')
 * // Returns: { primary: ['S1', 'S2'], secondary: ['U1'], constraints: [], unk: false }
 */
export function parseAttributionLine(line: string): AttributionLine | null {
  const trimmed = line.trim();
  if (!trimmed.toLowerCase().startsWith('attribution:')) {
    return null;
  }

  const content = trimmed.slice('attribution:'.length).trim();
  const pairs = content.split(';').map((pair) => pair.trim());

  const result: Record<string, string> = {};
  for (const pair of pairs) {
    if (pair === '') continue;
    const [key, value] = pair.split('=').map((s) => s.trim());
    if (key === undefined || value === undefined) {
      return null;
    }
    result[key.toLowerCase()] = value;
  }

  const parseIdList = (value: string | undefined): SourceId[] | null => {
    if (value === undefined || value === '') return [];
    const ids = value.split(',').map((id) => id.trim());
    for (const id of ids) {
      if (!/^[SU]\d+$/.test(id)) {
        return null;
      }
    }
    return ids as SourceId[];
  };

  const primary = parseIdList(result['primary']);
  const secondary = parseIdList(result['secondary']);
  const constraints = parseIdList(result['constraints']);

  if (primary === null || secondary === null || constraints === null) {
    return null;
  }

  const unkValue = result['unk'];
  let unk = false;
  if (unkValue === 'true') {
    unk = true;
  } else if (unkValue === 'false' || unkValue === undefined) {
    unk = false;
  } else {
    return null;
  }

  return {
    primary,
    secondary,
    constraints,
    unk,
  };
}

/**
 * Helper to detect heading level and extract title.
 * Returns null if line is not a heading.
 */
function parseHeading(line: string): { level: number; title: string } | null {
  const h2Regex = /^##\s+(.+)$/;
  const h2Match = h2Regex.exec(line);
  if (h2Match !== null) {
    const title = h2Match[1];
    return title !== undefined ? { level: 2, title } : null;
  }

  const h3Regex = /^###\s+(.+)$/;
  const h3Match = h3Regex.exec(line);
  if (h3Match !== null) {
    const title = h3Match[1];
    return title !== undefined ? { level: 3, title } : null;
  }

  return null;
}

/**
 * Parse sections from synthesis markdown output.
 * Sections are bounded by ## headings (preferred) or ### headings (fallback).
 * If no headings found, treats entire document as one section.
 */
export function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split('\n');

  const h2Headings: { line: number; title: string }[] = [];
  const h3Headings: { line: number; title: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const heading = parseHeading(line);
    if (heading !== null) {
      if (heading.level === 2) {
        h2Headings.push({ line: i, title: heading.title });
      } else if (heading.level === 3) {
        h3Headings.push({ line: i, title: heading.title });
      }
    }
  }

  const headings = h2Headings.length > 0 ? h2Headings : h3Headings;

  if (headings.length === 0) {
    const attribution = extractAttributionFromLines(lines, 0, lines.length - 1);
    return [
      {
        title: 'Synthesis',
        level: 2,
        attribution,
        startLine: 0,
        endLine: lines.length - 1,
      },
    ];
  }

  const sections: ParsedSection[] = [];
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];
    if (current === undefined) continue;

    const startLine = current.line;
    const endLine = next !== undefined ? next.line - 1 : lines.length - 1;

    const attribution = extractAttributionFromLines(lines, startLine, endLine);

    sections.push({
      title: current.title,
      level: h2Headings.length > 0 ? 2 : 3,
      attribution,
      startLine,
      endLine,
    });
  }

  return sections;
}

/**
 * Extract Attribution line from a range of lines.
 * Looks for the last non-empty line that starts with "Attribution:"
 */
function extractAttributionFromLines(
  lines: string[],
  startLine: number,
  endLine: number
): AttributionLine | null {
  for (let i = endLine; i >= startLine; i--) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.toLowerCase().startsWith('attribution:')) {
      return parseAttributionLine(trimmed);
    }
  }
  return null;
}

/**
 * Build a source map from reports and additional sources.
 * Maps to neutral IDs: S1..Sn for reports, U1..Um for additional sources.
 * Handles sparse arrays by assigning sequential IDs to defined elements only.
 */
export function buildSourceMap(
  reports: readonly ({ model: string } | undefined)[],
  additionalSources?: readonly { label?: string }[]
): SourceMapItem[] {
  const sourceMap: SourceMapItem[] = [];

  let llmCounter = 0;
  for (const report of reports) {
    if (report === undefined) continue;
    llmCounter++;
    sourceMap.push({
      id: `S${String(llmCounter)}` as SourceId,
      kind: 'llm',
      displayName: report.model,
    });
  }

  if (additionalSources !== undefined) {
    let userCounter = 0;
    for (const source of additionalSources) {
      if (source === undefined) continue;
      userCounter++;
      sourceMap.push({
        id: `U${String(userCounter)}` as SourceId,
        kind: 'user',
        displayName: source.label ?? `Source ${String(userCounter)}`,
      });
    }
  }

  return sourceMap;
}

/**
 * Validate attributions in synthesis output.
 * Returns validation result with list of errors if invalid.
 */
export function validateSynthesisAttributions(
  markdown: string,
  sourceMap: readonly SourceMapItem[]
): ValidationResult {
  const errors: string[] = [];
  const sections = parseSections(markdown);
  const validIds = new Set(sourceMap.map((item) => item.id));

  for (const section of sections) {
    if (section.attribution === null) {
      errors.push(`Section "${section.title}" is missing Attribution line`);
      continue;
    }

    const allIds = [
      ...section.attribution.primary,
      ...section.attribution.secondary,
      ...section.attribution.constraints,
    ];

    for (const id of allIds) {
      if (!validIds.has(id)) {
        errors.push(`Section "${section.title}" references unknown source ID: ${id}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate the Source Utilization Breakdown markdown appendix.
 * This is appended to the synthesis output by code, NOT by the LLM.
 */
export function generateBreakdown(
  sections: readonly ParsedSection[],
  sourceMap: readonly SourceMapItem[]
): string {
  if (sections.length === 0) {
    return '## Source Utilization Breakdown (Generated)\n\nNo sections found.\n';
  }

  const breakdownMap = new Map<SourceId, BreakdownEntry>();

  for (const source of sourceMap) {
    breakdownMap.set(source.id, {
      id: source.id,
      name: source.displayName,
      primaryCount: 0,
      secondaryCount: 0,
      constraintsCount: 0,
      score: 0,
      usedFor: {
        primary: [],
        secondary: [],
        constraints: [],
      },
    });
  }

  for (const section of sections) {
    if (section.attribution === null) continue;

    for (const id of section.attribution.primary) {
      const entry = breakdownMap.get(id);
      if (entry !== undefined) {
        entry.primaryCount++;
        entry.usedFor.primary.push(section.title);
      }
    }

    for (const id of section.attribution.secondary) {
      const entry = breakdownMap.get(id);
      if (entry !== undefined) {
        entry.secondaryCount++;
        entry.usedFor.secondary.push(section.title);
      }
    }

    for (const id of section.attribution.constraints) {
      const entry = breakdownMap.get(id);
      if (entry !== undefined) {
        entry.constraintsCount++;
        entry.usedFor.constraints.push(section.title);
      }
    }
  }

  for (const entry of breakdownMap.values()) {
    entry.score = entry.primaryCount * 3 + entry.secondaryCount;
  }

  const entries = Array.from(breakdownMap.values()).sort((a, b) => b.score - a.score);

  const ignoredSources = entries.filter(
    (e) => e.primaryCount === 0 && e.secondaryCount === 0 && e.constraintsCount === 0
  );
  const usedSources = entries.filter(
    (e) => e.primaryCount > 0 || e.secondaryCount > 0 || e.constraintsCount > 0
  );

  let output = '## Source Utilization Breakdown (Generated)\n\n';
  output += '### Scorecard\n\n';
  output += '| ID | Name | Primary | Secondary | Constraints | Score |\n';
  output += '|----|------|---------|-----------|-------------|-------|\n';

  for (const entry of usedSources) {
    output += `| ${entry.id} | ${entry.name} | ${String(entry.primaryCount)} | ${String(entry.secondaryCount)} | ${String(entry.constraintsCount)} | ${String(entry.score)} |\n`;
  }

  if (usedSources.length === 0) {
    output += '| — | — | — | — | — | — |\n';
  }

  output += '\n### Per-Source Usage\n\n';

  for (const entry of usedSources) {
    const primaryText = entry.usedFor.primary.length > 0 ? entry.usedFor.primary.join(', ') : '—';
    const secondaryText =
      entry.usedFor.secondary.length > 0 ? entry.usedFor.secondary.join(', ') : '—';
    const constraintsText =
      entry.usedFor.constraints.length > 0 ? entry.usedFor.constraints.join(', ') : '—';

    output += `- **${entry.id}** (${entry.name}): Primary in: ${primaryText}. Secondary in: ${secondaryText}. Constraints in: ${constraintsText}\n`;
  }

  if (usedSources.length === 0) {
    output += 'No sources were used.\n';
  }

  output += '\n### Ignored Sources\n\n';

  if (ignoredSources.length === 0) {
    output += 'None.\n';
  } else if (ignoredSources.length === sourceMap.length) {
    output += 'All sources were ignored.\n';
  } else {
    for (const entry of ignoredSources) {
      output += `- **${entry.id}** (${entry.name})\n`;
    }
  }

  output += '\n_Attribution data derived from parsed markers. No interpretation applied._\n';

  return output;
}

/**
 * Strip attribution lines from markdown content.
 * Removes lines starting with "Attribution:" (case-insensitive) while preserving all other content.
 * Used when rendering HTML reports to hide section-level attributions.
 */
export function stripAttributionLines(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !line.trim().toLowerCase().startsWith('attribution:'))
    .join('\n');
}
