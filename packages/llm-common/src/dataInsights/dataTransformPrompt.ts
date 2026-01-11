/**
 * Prompt builder for data transformation (Prompt 3).
 * Transforms snapshot data according to chart definition instructions.
 */

import type { PromptBuilder } from '../types.js';

/**
 * Input for data transformation prompt.
 */
export interface DataTransformPromptInput {
  /**
   * JSON schema of the composite feed structure.
   */
  jsonSchema: object;

  /**
   * Snapshot data to transform.
   */
  snapshotData: object;

  /**
   * Chart configuration (without data).
   */
  chartConfig: object;

  /**
   * Transformation instructions from Prompt 2.
   */
  transformInstructions: string;

  /**
   * Data insight context.
   */
  insight: {
    title: string;
    trackableMetric: string;
  };
}

/**
 * Dependencies for data transformation prompt (none required).
 */
export interface DataTransformPromptDeps {}

/**
 * Build data transformation prompt (Prompt 3).
 */
export const dataTransformPrompt: PromptBuilder<
  DataTransformPromptInput,
  DataTransformPromptDeps
> = () => (input) => {
  const jsonSchema = JSON.stringify(input.jsonSchema, null, 2);
  const snapshotData = JSON.stringify(input.snapshotData, null, 2);
  const chartConfig = JSON.stringify(input.chartConfig, null, 2);

  return `## Your Task
Transform the snapshot data according to the provided instructions.
Output ONLY the transformed data as a JSON array.

## Composite Feed Schema
${jsonSchema}

## Snapshot Data
${snapshotData}

## Chart Configuration
${chartConfig}

## Data Insight Context
Title: ${input.insight.title}
Trackable Metric: ${input.insight.trackableMetric}

## Transformation Instructions
${input.transformInstructions}

## Output Requirements
Transform the data and output in this EXACT format:

DATA_START
[
  { "field1": "value1", "field2": 123 },
  { "field1": "value2", "field2": 456 }
]
DATA_END

RULES:
- Output ONLY valid JSON array between DATA_START and DATA_END
- Each object must match the chart encoding fields from the configuration
- Do NOT include any text outside the markers
- Do NOT modify the schema, only transform data
- Ensure field names exactly match what the chart expects
- All values must be properly typed (strings, numbers, dates, etc.)`;
};
