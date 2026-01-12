/**
 * Parser for data analysis LLM responses (attribution-style validation).
 */

const VALID_CHART_TYPES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'] as const;

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

function parseInsightLine(line: string, lineNumber: number): ParsedDataInsight {
  const match = /^INSIGHT_\d+:\s*(.+)$/.exec(line);
  if (!match) {
    throw new Error(
      `Line ${String(lineNumber)}: Invalid INSIGHT format - must start with INSIGHT_N:`
    );
  }

  const content = match[1];
  if (content === undefined) {
    throw new Error(`Line ${String(lineNumber)}: Invalid INSIGHT format - content is undefined`);
  }

  const parts = content.split(';').map((p) => p.trim());

  if (parts.length !== 4) {
    throw new Error(
      `Line ${String(lineNumber)}: Expected 4 parts (Title, Description, Trackable, ChartType), got ${String(parts.length)}`
    );
  }

  if (
    parts[0] === undefined ||
    parts[1] === undefined ||
    parts[2] === undefined ||
    parts[3] === undefined
  ) {
    throw new Error(`Line ${String(lineNumber)}: Missing required parts`);
  }

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

  if (title.length === 0) {
    throw new Error(`Line ${String(lineNumber)}: Title cannot be empty`);
  }

  if (description.length === 0) {
    throw new Error(`Line ${String(lineNumber)}: Description cannot be empty`);
  }

  const sentenceCount = description.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
  if (sentenceCount > 3) {
    throw new Error(
      `Line ${String(lineNumber)}: Description must be max 3 sentences, got ${String(sentenceCount)}`
    );
  }

  if (trackableMetric.length === 0) {
    throw new Error(`Line ${String(lineNumber)}: Trackable metric cannot be empty`);
  }

  if (!VALID_CHART_TYPES.includes(suggestedChartType as (typeof VALID_CHART_TYPES)[number])) {
    throw new Error(
      `Line ${String(lineNumber)}: Invalid ChartType '${suggestedChartType}', must be one of: ${VALID_CHART_TYPES.join(', ')}`
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
  if (reason.length === 0) {
    throw new Error(`Line ${String(lineNumber)}: Reason cannot be empty`);
  }

  return reason;
}

export function parseInsightResponse(response: string): ParseInsightResult {
  const lines = response
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error('Empty response from LLM');
  }

  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new Error('Empty response from LLM');
  }

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
    if (line === undefined) {
      throw new Error(`Line ${String(i + 1)}: Line is undefined`);
    }
    if (!line.startsWith('INSIGHT_')) {
      throw new Error(
        `Line ${String(i + 1)}: Expected INSIGHT_N or NO_INSIGHTS, got: '${line.substring(0, 20)}...'`
      );
    }
    const insight = parseInsightLine(line, i + 1);
    insights.push(insight);
  }

  if (insights.length === 0) {
    throw new Error('No insights found in response');
  }

  if (insights.length > 5) {
    throw new Error(`Too many insights: expected max 5, got ${String(insights.length)}`);
  }

  return { insights };
}
