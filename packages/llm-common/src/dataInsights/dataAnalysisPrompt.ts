/**
 * Prompt builder for data analysis (Prompt 1).
 * Analyzes composite feed data and generates up to 5 measurable, trackable insights.
 */

import type { PromptBuilder } from '../types.js';

export interface ChartTypeInfo {
  id: string;
  name: string;
  bestFor: string;
  vegaLiteSchema: object;
}

export interface DataAnalysisPromptInput {
  jsonSchema: object;
  snapshotData: object;
  chartTypes: ChartTypeInfo[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DataAnalysisPromptDeps {}

function buildChartTypesTable(chartTypes: ChartTypeInfo[]): string {
  const header = 'ID   | Name         | Best For                    | Vega-Lite Schema';
  const separator = '-----|--------------|-----------------------------|-----------------';
  const rows = chartTypes.map((ct) => {
    const schemaStr = JSON.stringify(ct.vegaLiteSchema, null, 2);
    return `${ct.id.padEnd(4)} | ${ct.name.padEnd(12)} | ${ct.bestFor.padEnd(27)} | ${schemaStr}`;
  });
  return [header, separator, ...rows].join('\n');
}

export const dataAnalysisPrompt: PromptBuilder<DataAnalysisPromptInput, DataAnalysisPromptDeps> = {
  name: 'data-analysis',
  description: 'Analyzes composite feed data and generates measurable, trackable insights',
  build(input: DataAnalysisPromptInput): string {
    const chartTypesTable = buildChartTypesTable(input.chartTypes);
    const jsonSchema = JSON.stringify(input.jsonSchema, null, 2);
    const snapshotData = JSON.stringify(input.snapshotData, null, 2);

    return `## Your Task
Analyze the provided data snapshot and identify measurable, trackable data insights.
You MUST NOT generate chart definitions. FORBIDDEN.

## Composite Feed Schema
${jsonSchema}

## Snapshot Data
${snapshotData}

## Supported Visualization Types
${chartTypesTable}

## Output Requirements
Generate up to 5 data insights. Each insight MUST follow this EXACT format:

INSIGHT_1: Title=<title>; Description=<2-3 sentences>; Trackable=<metric description>; ChartType=<C1-C6>
INSIGHT_2: Title=<title>; Description=<2-3 sentences>; Trackable=<metric description>; ChartType=<C1-C6>
...

If you cannot generate any insights, respond with:
NO_INSIGHTS: Reason=<explanation why data is insufficient>

RULES:
- Focus ONLY on measurable and trackable insights
- Each insight must be unique and actionable
- ChartType must be one of: C1, C2, C3, C4, C5, C6
- Do NOT include chart configuration or data transformation
- Do NOT include any text outside the specified format
- Description must be 2-3 sentences maximum
- Each INSIGHT line must be on a single line (no line breaks within the line)`;
  },
};
