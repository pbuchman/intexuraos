/**
 * Zod schemas for data insights (chart definition, data analysis, data transform).
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

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
 * Schema for data insight (from analysis LLM response).
 */
export const DataInsightSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  trackableMetric: z.string().min(1),
  suggestedChartType: z.enum(['C1', 'C2', 'C3', 'C4', 'C5', 'C6']),
});

export type DataInsight = z.infer<typeof DataInsightSchema>;

/**
 * Schema for transformed data array.
 * Each item must be an object (passthrough allows any properties).
 */
export const TransformedDataSchema = z
  .array(z.object({}).passthrough())
  .min(1, { message: 'Data array cannot be empty' });

export type TransformedData = z.infer<typeof TransformedDataSchema>;
