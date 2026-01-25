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
