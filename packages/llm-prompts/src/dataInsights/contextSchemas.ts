/**
 * Zod schemas for data insights (chart definition, data analysis, data transform).
 * Types are derived from schemas using z.infer<> for single source of truth.
 *
 * Chart ID validation uses DEFAULT_CHART_IDS as the canonical source.
 * Use createDataInsightSchema() to create schemas with custom chart ID sets.
 */

import { z } from 'zod';

import { DEFAULT_CHART_IDS } from './parseInsightResponse.js';

/**
 * Schema for Vega-Lite chart configuration.
 * Validates required properties and ensures no "data" property is included.
 */
export const VegaLiteConfigSchema = z
  .object({
    $schema: z.string(),
    mark: z.union([z.string(), z.object({})]),
    encoding: z.object({}).passthrough(),
    width: z.union([z.string(), z.number()]).optional(),
    height: z.union([z.string(), z.number()]).optional(),
    title: z.union([z.string(), z.object({})]).optional(),
  })
  .passthrough()
  .refine((config) => !('data' in config), {
    message: 'Chart config must NOT include "data" property',
  })
  .refine((config) => '$schema' in config, {
    message: 'Chart config must include "$schema" property',
  })
  .refine((config) => 'mark' in config, {
    message: 'Chart config must include "mark" property',
  })
  .refine((config) => 'encoding' in config, {
    message: 'Chart config must include "encoding" property',
  });

export type VegaLiteConfig = z.infer<typeof VegaLiteConfigSchema>;

/**
 * Create a DataInsight schema with a custom set of valid chart IDs.
 * Use this when chart catalogs differ from the default C1-C6 set.
 *
 * @param validChartIds - Array with at least one chart ID
 */
export function createDataInsightSchema(
  validChartIds: readonly [string, ...string[]]
): z.ZodObject<{
  title: z.ZodString;
  description: z.ZodString;
  trackableMetric: z.ZodString;
  suggestedChartType: z.ZodEnum<[string, ...string[]]>;
}> {
  return z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    trackableMetric: z.string().min(1),
    suggestedChartType: z.enum(validChartIds),
  });
}

/**
 * Schema for data insight (from analysis LLM response).
 * Uses DEFAULT_CHART_IDS as the canonical chart ID set.
 */
export const DataInsightSchema = createDataInsightSchema(
  DEFAULT_CHART_IDS as unknown as [string, ...string[]]
);

export type DataInsight = z.infer<typeof DataInsightSchema>;

/**
 * Schema for transformed data array.
 * Each item must be an object (passthrough allows any properties).
 * Empty arrays are valid when transformations yield zero matching rows.
 */
export const TransformedDataSchema = z.array(z.object({}).passthrough());

export type TransformedData = z.infer<typeof TransformedDataSchema>;
