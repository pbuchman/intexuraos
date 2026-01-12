import type { PromptBuilder } from '../types.js';

export interface DataTransformPromptInput {
  jsonSchema: object;
  snapshotData: object;
  chartConfig: object;
  transformInstructions: string;
  insight: {
    title: string;
    trackableMetric: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DataTransformPromptDeps {}

export const dataTransformPrompt: PromptBuilder<DataTransformPromptInput, DataTransformPromptDeps> =
  {
    name: 'data-transform',
    description: 'Transforms snapshot data according to chart definition instructions',
    build(input: DataTransformPromptInput): string {
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
    },
  };
