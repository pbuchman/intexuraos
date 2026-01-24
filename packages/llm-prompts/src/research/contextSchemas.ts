/**
 * Zod schemas for research context inference.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';
import {
  DefaultAppliedSchema,
  DomainSchema,
  ModeSchema,
  SafetyInfoSchema,
} from '../shared/contextSchemas.js';

/**
 * Valid answer style values.
 */
export const ANSWER_STYLES = [
  'practical',
  'evidence_first',
  'step_by_step',
  'executive',
  'checklist',
] as const;

/**
 * Valid source type values.
 */
export const SOURCE_TYPES = [
  'official',
  'primary_docs',
  'regulators',
  'manufacturers',
  'academic',
  'reputable_media',
  'community',
] as const;

/**
 * Valid avoid source type values.
 */
export const AVOID_SOURCE_TYPES = ['random_blogs', 'seo_farms', 'unknown_affiliates'] as const;

/**
 * Schema for AnswerStyle type.
 */
export const AnswerStyleSchema = z.enum(ANSWER_STYLES);

/**
 * Schema for SourceType type.
 */
export const SourceTypeSchema = z.enum(SOURCE_TYPES);

/**
 * Schema for AvoidSourceType type.
 */
export const AvoidSourceTypeSchema = z.enum(AVOID_SOURCE_TYPES);

/**
 * Schema for TimeScope objects.
 */
export const TimeScopeSchema = z.object({
  as_of_date: z.string(),
  prefers_recent_years: z.number(),
  is_time_sensitive: z.boolean(),
});

/**
 * Schema for LocaleScope objects.
 */
export const LocaleScopeSchema = z.object({
  country_or_region: z.string(),
  jurisdiction: z.string(),
  currency: z.string(),
});

/**
 * Schema for ResearchPlan objects.
 */
export const ResearchPlanSchema = z.object({
  key_questions: z.array(z.string()),
  search_queries: z.array(z.string()),
  preferred_source_types: z.array(SourceTypeSchema),
  avoid_source_types: z.array(AvoidSourceTypeSchema),
});

/**
 * Schema for OutputFormat objects.
 */
export const OutputFormatSchema = z.object({
  wants_table: z.boolean(),
  wants_steps: z.boolean(),
  wants_pros_cons: z.boolean(),
  wants_budget_numbers: z.boolean(),
});

/**
 * Schema for ResearchContext objects.
 */
export const ResearchContextSchema = z.object({
  language: z.string(),
  domain: DomainSchema,
  mode: ModeSchema,
  intent_summary: z.string(),
  defaults_applied: z.array(DefaultAppliedSchema),
  assumptions: z.array(z.string()),
  answer_style: z.array(AnswerStyleSchema),
  time_scope: TimeScopeSchema,
  locale_scope: LocaleScopeSchema,
  research_plan: ResearchPlanSchema,
  output_format: OutputFormatSchema,
  safety: SafetyInfoSchema,
  red_flags: z.array(z.string()),
});

// Export derived types
export type AnswerStyle = z.infer<typeof AnswerStyleSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type AvoidSourceType = z.infer<typeof AvoidSourceTypeSchema>;
export type TimeScope = z.infer<typeof TimeScopeSchema>;
export type LocaleScope = z.infer<typeof LocaleScopeSchema>;
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type OutputFormat = z.infer<typeof OutputFormatSchema>;
export type ResearchContext = z.infer<typeof ResearchContextSchema>;

/**
 * Options for inferring research context.
 */
export interface InferResearchContextOptions {
  asOfDate?: string;
  defaultCountryOrRegion?: string;
  defaultJurisdiction?: string;
  defaultCurrency?: string;
  prefersRecentYears?: number;
}
