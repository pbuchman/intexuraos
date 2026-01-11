/**
 * Prompt builder for chart definition (Prompt 2).
 * Generates chart configuration based on a specific data insight.
 */

import type { PromptBuilder } from '../types.js';

/**
 * Input for chart definition prompt.
 */
export interface ChartDefinitionPromptInput {
  /**
   * JSON schema of the composite feed structure.
   */
  jsonSchema: object;

  /**
   * Snapshot data from the composite feed (for reference).
   */
  snapshotData: object;

  /**
   * Exact Vega-Lite schema for the target chart type.
   */
  targetChartSchema: object;

  /**
   * Data insight to create chart for.
   */
  insight: {
    title: string;
    description: string;
    trackableMetric: string;
    suggestedChartType: string;
  };
}

/**
 * Dependencies for chart definition prompt (none required).
 */
export interface ChartDefinitionPromptDeps {}

/**
 * Build chart definition prompt (Prompt 2).
 */
export const chartDefinitionPrompt: PromptBuilder<
  ChartDefinitionPromptInput,
  ChartDefinitionPromptDeps
> = () => (input) => {
  const jsonSchema = JSON.stringify(input.jsonSchema, null, 2);
  const snapshotData = JSON.stringify(input.snapshotData, null, 2);
  const targetSchema = JSON.stringify(input.targetChartSchema, null, 2);

  return `## Your Task
Generate a detailed chart configuration for the specified insight.
You MUST NOT transform data. You MUST NOT include actual data values. FORBIDDEN.

## Composite Feed Schema
${jsonSchema}

## Snapshot Data (for reference only)
${snapshotData}

## Data Insight
Title: ${input.insight.title}
Description: ${input.insight.description}
Trackable Metric: ${input.insight.trackableMetric}
Suggested Chart Type: ${input.insight.suggestedChartType}

## Target Chart Vega-Lite Schema
${targetSchema}

## Output Requirements
Generate chart configuration in this EXACT format:

CHART_CONFIG_START
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "title": "...",
  "width": "container",
  "mark": "...",
  "encoding": {
    "x": { "field": "...", "type": "...", "title": "..." },
    "y": { "field": "...", "type": "...", "title": "..." }
  }
}
CHART_CONFIG_END

TRANSFORM_INSTRUCTIONS_START
Detailed instructions for transforming snapshot data into chart-ready format:
1. Extract field X from path data.items[].value
2. Aggregate by field Y using SUM
3. Sort by date ascending
...
TRANSFORM_INSTRUCTIONS_END

RULES:
- Chart config must NOT include "data" property
- Chart config must match the target Vega-Lite schema structure
- Transform instructions must be detailed and unambiguous
- Do NOT include actual data values in the config
- Ensure field names in encoding match what will be in transformed data`;
};
