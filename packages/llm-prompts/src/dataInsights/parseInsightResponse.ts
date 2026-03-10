/**
 * Parser for data analysis LLM responses (attribution-style validation).
 *
 * Chart ID validation uses a canonical source (DEFAULT_CHART_IDS) that can be
 * overridden at runtime via the validChartIds parameter. This ensures the parser
 * and prompt builder stay in sync when chart catalogs change.
 */

import type { ChartTypeInfo } from './dataAnalysisPrompt.js';

/**
 * Canonical chart IDs shared across parser, prompt, schema, and repair prompt.
 * This is the single source of truth for the default chart ID set.
 */
export const DEFAULT_CHART_IDS: readonly string[] = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

/**
 * Extract valid chart IDs from a ChartTypeInfo array.
 * Use this to derive parser-compatible IDs from the same input passed to the prompt builder.
 */
export function extractValidChartIds(chartTypes: ChartTypeInfo[]): string[] {
  return chartTypes.map((ct) => ct.id);
}

export interface ParsedDataInsight {
  title: string;
  description: string;
  trackableMetric: string;
  suggestedChartType: string;
}

export interface ParseInsightResult {
  insights: ParsedDataInsight[];
  noInsightsReason?: string;
}

function parseInsightLine(
  line: string,
  lineNumber: number,
  validChartIds: readonly string[]
): ParsedDataInsight {
  const match = /^INSIGHT_\d+:\s*(.+)$/.exec(line);
  if (!match) {
    throw new Error(
      `Line ${String(lineNumber)}: Invalid INSIGHT format - must start with INSIGHT_N:`
    );
  }

  const content = match[1];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires guard but regex (.+) capture cannot be undefined when match succeeds @preserve */
  if (content === undefined) {
    throw new Error(`Line ${String(lineNumber)}: Invalid INSIGHT format - content is undefined`);
  }
  /* v8 ignore stop @preserve */

  const parts = content.split(';').map((p) => p.trim());

  if (parts.length !== 4) {
    throw new Error(
      `Line ${String(lineNumber)}: Expected 4 parts (Title, Description, Trackable, ChartType), got ${String(parts.length)}`
    );
  }

  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires guard but parts.length === 4 check above guarantees all four elements exist @preserve */
  if (
    parts[0] === undefined ||
    parts[1] === undefined ||
    parts[2] === undefined ||
    parts[3] === undefined
  ) {
    throw new Error(`Line ${String(lineNumber)}: Missing required parts`);
  }
  /* v8 ignore stop @preserve */

  const part0 = parts[0];
  const part1 = parts[1];
  const part2 = parts[2];
  const part3 = parts[3];

  const titleRaw = /^Title=(.+)$/.exec(part0);
  if (titleRaw?.[1] === undefined) {
    throw new Error(`Line ${String(lineNumber)}: Title field missing or malformed`);
  }
  const title = titleRaw[1].trim();

  const descRaw = /^Description=(.+)$/.exec(part1);
  if (descRaw?.[1] === undefined) {
    throw new Error(`Line ${String(lineNumber)}: Description field missing or malformed`);
  }
  const description = descRaw[1].trim();

  const sentenceCount = description.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  // Allow up to 6 sentences (2x the expected 3) since LLMs struggle with precise counting
  if (sentenceCount > 6) {
    throw new Error(
      `Line ${String(lineNumber)}: Description must be max 6 sentences, got ${String(sentenceCount)}`
    );
  }

  const trackableRaw = /^Trackable=(.+)$/.exec(part2);
  if (trackableRaw?.[1] === undefined) {
    throw new Error(`Line ${String(lineNumber)}: Trackable field missing or malformed`);
  }
  const trackableMetric = trackableRaw[1].trim();

  const chartTypeRaw = /^ChartType=([A-Z0-9]+)$/.exec(part3);
  if (chartTypeRaw?.[1] === undefined) {
    throw new Error(`Line ${String(lineNumber)}: ChartType field missing or malformed`);
  }
  const suggestedChartType = chartTypeRaw[1].trim();

  if (!validChartIds.includes(suggestedChartType)) {
    throw new Error(
      `Line ${String(lineNumber)}: Invalid ChartType '${suggestedChartType}', must be one of: ${validChartIds.join(', ')}`
    );
  }

  return {
    title,
    description,
    trackableMetric,
    suggestedChartType,
  };
}

function parseNoInsightsLine(line: string, lineNumber: number): string {
  const match = /^NO_INSIGHTS:\s*Reason=(.+)$/.exec(line);
  if (match?.[1] === undefined) {
    throw new Error(
      `Line ${String(lineNumber)}: Invalid NO_INSIGHTS format - must be 'NO_INSIGHTS: Reason=...'`
    );
  }

  const reason = match[1].trim();

  return reason;
}

/**
 * Parse an LLM insight response, validating chart IDs against the provided set.
 *
 * @param response - Raw LLM response text
 * @param validChartIds - Accepted chart IDs. Defaults to DEFAULT_CHART_IDS.
 *   Pass extractValidChartIds(chartTypes) to use the same IDs as the prompt builder.
 */
export function parseInsightResponse(
  response: string,
  validChartIds: readonly string[] = DEFAULT_CHART_IDS
): ParseInsightResult {
  const lines = response
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('Empty response from LLM');
  }

  const firstLine = lines[0];
  /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires guard but lines.length > 0 check above guarantees element exists @preserve */
  if (firstLine === undefined) {
    throw new Error('Empty response from LLM');
  }
  /* v8 ignore stop @preserve */

  if (firstLine.startsWith('NO_INSIGHTS:')) {
    if (lines.length > 1) {
      throw new Error('NO_INSIGHTS response must be a single line');
    }
    const reason = parseNoInsightsLine(firstLine, 1);
    return { insights: [], noInsightsReason: reason };
  }

  const insights: ParsedDataInsight[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    /* v8 ignore start -- ts-type: noUncheckedIndexedAccess requires guard but loop bound i < lines.length guarantees element exists @preserve */
    if (line === undefined) {
      throw new Error(`Line ${String(i + 1)}: Line is undefined`);
    }
    /* v8 ignore stop @preserve */
    if (!line.startsWith('INSIGHT_')) {
      throw new Error(
        `Line ${String(i + 1)}: Expected INSIGHT_N or NO_INSIGHTS, got: '${line.substring(0, 20)}...'`
      );
    }
    const insight = parseInsightLine(line, i + 1, validChartIds);
    insights.push(insight);
  }

  /* v8 ignore start -- ts-type: non-empty lines array with mandatory INSIGHT_ prefix means loop always pushes at least one element @preserve */
  if (insights.length === 0) {
    throw new Error('No insights found in response');
  }
  /* v8 ignore stop @preserve */

  if (insights.length > 5) {
    throw new Error(`Too many insights: expected max 5, got ${String(insights.length)}`);
  }

  return { insights };
}
