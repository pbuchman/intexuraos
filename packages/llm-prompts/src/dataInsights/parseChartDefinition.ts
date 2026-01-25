/**
 * Parser for chart definition LLM responses.
 */

import { VegaLiteConfigSchema } from './contextSchemas.js';

/**
 * Parsed chart definition from LLM response.
 */
export interface ParsedChartDefinition {
  vegaLiteConfig: object;
  transformInstructions: string;
}

/**
 * Parse chart definition response from LLM.
 * Expected format:
 *   CHART_CONFIG_START
 *   {...json...}
 *   CHART_CONFIG_END
 *
 *   TRANSFORM_INSTRUCTIONS_START
 *   ...instructions...
 *   TRANSFORM_INSTRUCTIONS_END
 */
export function parseChartDefinition(response: string): ParsedChartDefinition {
  const chartConfigMatch = /CHART_CONFIG_START\s*([\s\S]*?)\s*CHART_CONFIG_END/.exec(response);
  const transformMatch =
    /TRANSFORM_INSTRUCTIONS_START\s*([\s\S]*?)\s*TRANSFORM_INSTRUCTIONS_END/.exec(response);

  if (chartConfigMatch?.[1] === undefined) {
    throw new Error('Missing CHART_CONFIG_START...CHART_CONFIG_END markers');
  }

  if (transformMatch?.[1] === undefined) {
    throw new Error('Missing TRANSFORM_INSTRUCTIONS_START...TRANSFORM_INSTRUCTIONS_END markers');
  }

  const chartConfigJson = chartConfigMatch[1].trim();
  const transformInstructions = transformMatch[1].trim();

  if (chartConfigJson.length === 0) {
    throw new Error('Chart config is empty');
  }

  if (transformInstructions.length === 0) {
    throw new Error('Transform instructions are empty');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(chartConfigJson);
  } catch (error) {
    throw new Error(`Invalid JSON in chart config: ${String(error)}`);
  }

  if (typeof parsed !== 'object') {
    throw new Error('Chart config must be an object');
  }

  const validationResult = VegaLiteConfigSchema.safeParse(parsed);
  if (!validationResult.success) {
    const issues = validationResult.error.issues;
    const errorMessages = issues.map((issue) => issue.message).join(', ');
    throw new Error(`Invalid chart config: ${errorMessages}`);
  }

  return {
    vegaLiteConfig: validationResult.data,
    transformInstructions,
  };
}
