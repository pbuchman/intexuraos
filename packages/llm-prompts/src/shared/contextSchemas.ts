/**
 * Zod schemas for shared context types.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';

/**
 * Valid domain values for context inference.
 */
export const DOMAINS = [
  'travel',
  'product',
  'technical',
  'legal',
  'medical',
  'financial',
  'security_privacy',
  'business_strategy',
  'marketing_sales',
  'hr_people_ops',
  'education_learning',
  'science_research',
  'history_culture',
  'politics_policy',
  'real_estate',
  'food_nutrition',
  'fitness_sports',
  'entertainment_media',
  'construction_building',
  'diy_home',
  'outdoor_recreation',
  'fishing',
  'general',
  'unknown',
] as const;

/**
 * Valid mode values for context inference.
 */
export const MODES = ['compact', 'standard', 'audit'] as const;

/**
 * Schema for Domain type.
 */
export const DomainSchema = z.enum(DOMAINS);

/**
 * Schema for Mode type.
 */
export const ModeSchema = z.enum(MODES);

/**
 * Schema for DefaultApplied objects.
 */
export const DefaultAppliedSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  reason: z.string(),
});

/**
 * Schema for SafetyInfo objects.
 */
export const SafetyInfoSchema = z.object({
  high_stakes: z.boolean(),
  required_disclaimers: z.array(z.string()),
  /**
   * Zod `.optional().transform()` creates divergent input/output types.
   * The `as unknown as` cast forces both to `string[]`, preventing TS2719
   * errors when types resolve from both `dist/` and source paths.
   */
  user_exclusions: z
    .array(z.string())
    .optional()
    .transform((v) => v ?? []) as unknown as z.ZodType<string[]>,
});

/**
 * Schema for InputQualityResult objects.
 * Used for validating input quality assessment responses from LLMs.
 *
 * Note: The schema supports both 'quality' and 'quality_scale' fields
 * for backwards compatibility with the old guard implementation.
 * At least one of them must be provided.
 * The transform normalizes both to the canonical 'quality' field.
 */
const baseSchema = z.object({
  quality: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  quality_scale: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  reason: z.string().min(1),
});

export const InputQualitySchema = baseSchema
  .refine((data) => data.quality !== undefined || data.quality_scale !== undefined, {
    message: 'At least one of quality or quality_scale must be provided',
    path: ['quality'],
  })
  .transform((data) => {
    const qualityValue = (data.quality ?? data.quality_scale) as 0 | 1 | 2;
    return {
      quality: qualityValue,
      reason: data.reason,
    };
  }) as unknown as z.ZodType<{ quality: 0 | 1 | 2; reason: string }>;

// Export derived types
export type Domain = z.infer<typeof DomainSchema>;
export type Mode = z.infer<typeof ModeSchema>;
export type DefaultApplied = z.infer<typeof DefaultAppliedSchema>;
export type SafetyInfo = z.infer<typeof SafetyInfoSchema>;
export type InputQuality = z.infer<typeof InputQualitySchema>;
