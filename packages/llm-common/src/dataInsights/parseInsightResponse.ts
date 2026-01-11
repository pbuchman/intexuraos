/**
 * Parser for data analysis LLM responses (attribution-style validation).
 */

/**
 * Chart type IDs.
 */
const VALID_CHART_TYPES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const;

/**
 * Parsed data insight from LLM response.
 */
export interface ParsedDataInsight {
  title: string;
  description: string;
  trackableMetric: string;
  suggestedChartType: string;
}

/**
 * Result of parsing insight response.
 */
export interface ParseInsightResult {
  insights: ParsedDataInsight[];
  noInsightsReason?: string;
}

/**
 * Parse a single INSIGHT line.
 * Expected format: INSIGHT_N: Title=<title>; Description=<desc>; Trackable=<metric>; ChartType=<C1-C6>
 */
function parseInsightLine(line: string, lineNumber: number): ParsedDataInsight {
  const match = line.match(/^INSIGHT_\d+:\s*(.+)$/);
  if (!match) {
    throw new Error(`Line ${lineNumber}: Invalid INSIGHT format - must start with INSIGHT_N:`);
  }

  const content = match[1];
  const parts = content.split(';').map((p) => p.trim());

  if (parts.length !== 4) {
    throw new Error(
      `Line ${lineNumber}: Expected 4 parts (Title, Description, Trackable, ChartType), got ${parts.length}`
    );
  }

  const titleMatch = parts[0].match(/^Title=(.+)$/);
  const descMatch = parts[1].match(/^Description=(.+)$/);
  const trackableMatch = parts[2].match(/^Trackable=(.+)$/);
  const chartTypeMatch = parts[3].match(/^ChartType=([A-Z0-9]+)$/);

  if (!titleMatch) {
    throw new Error(`Line ${lineNumber}: Title field missing or malformed`);
  }
  if (!descMatch) {
    throw new Error(`Line ${lineNumber}: Description field missing or malformed`);
  }
  if (!trackableMatch) {
    throw new Error(`Line ${lineNumber}: Trackable field missing or malformed`);
  }
  if (!chartTypeMatch) {
    throw new Error(`Line ${lineNumber}: ChartType field missing or malformed`);
  }

  const title = titleMatch[1].trim();
  const description = descMatch[1].trim();
  const trackableMetric = trackableMatch[1].trim();
  const suggestedChartType = chartTypeMatch[1].trim();

  if (title.length === 0) {
    throw new Error(`Line ${lineNumber}: Title cannot be empty`);
  }

  if (description.length === 0) {
    throw new Error(`Line ${lineNumber}: Description cannot be empty`);
  }

  const sentenceCount = description.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  if (sentenceCount > 3) {
    throw new Error(
      `Line ${lineNumber}: Description must be max 3 sentences, got ${sentenceCount}`
    );
  }

  if (trackableMetric.length === 0) {
    throw new Error(`Line ${lineNumber}: Trackable metric cannot be empty`);
  }

  if (!VALID_CHART_TYPES.includes(suggestedChartType as (typeof VALID_CHART_TYPES)[number])) {
    throw new Error(
      `Line ${lineNumber}: Invalid ChartType '${suggestedChartType}', must be one of: ${VALID_CHART_TYPES.join(', ')}`
    );
  }

  return {
    title,
    description,
    trackableMetric,
    suggestedChartType,
  };
}

/**
 * Parse NO_INSIGHTS line.
 * Expected format: NO_INSIGHTS: Reason=<explanation>
 */
function parseNoInsightsLine(line: string, lineNumber: number): string {
  const match = line.match(/^NO_INSIGHTS:\s*Reason=(.+)$/);
  if (!match) {
    throw new Error(`Line ${lineNumber}: Invalid NO_INSIGHTS format - must be 'NO_INSIGHTS: Reason=...'`);
  }

  const reason = match[1].trim();
  if (reason.length === 0) {
    throw new Error(`Line ${lineNumber}: Reason cannot be empty`);
  }

  return reason;
}

/**
 * Parse insight response from LLM (attribution-style validation).
 * Throws error if response doesn't match expected format.
 */
export function parseInsightResponse(response: string): ParseInsightResult {
  const lines = response
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('Empty response from LLM');
  }

  if (lines[0].startsWith('NO_INSIGHTS:')) {
    if (lines.length > 1) {
      throw new Error('NO_INSIGHTS response must be a single line');
    }
    const reason = parseNoInsightsLine(lines[0], 1);
    return { insights: [], noInsightsReason: reason };
  }

  const insights: ParsedDataInsight[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('INSIGHT_')) {
      throw new Error(
        `Line ${i + 1}: Expected INSIGHT_N or NO_INSIGHTS, got: '${line.substring(0, 20)}...'`
      );
    }
    const insight = parseInsightLine(line, i + 1);
    insights.push(insight);
  }

  if (insights.length === 0) {
    throw new Error('No insights found in response');
  }

  if (insights.length > 5) {
    throw new Error(`Too many insights: expected max 5, got ${insights.length}`);
  }

  return { insights };
}
