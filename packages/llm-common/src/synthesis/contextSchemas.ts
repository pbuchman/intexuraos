/**
 * Zod schemas for synthesis context inference.
 * Types are derived from schemas using z.infer<> for single source of truth.
 */

import { z } from 'zod';
import {
  DefaultAppliedSchema,
  DomainSchema,
  ModeSchema,
  SafetyInfoSchema,
} from '../shared/contextSchemas.js';
import type {
  AdditionalSource,
  SynthesisReport as LlmReport,
} from '../research/synthesisPrompt.js';

// Re-export types from synthesisPrompt for backwards compatibility
export type { AdditionalSource, LlmReport };

/**
 * Valid synthesis goal values.
 */
export const SYNTHESIS_GOALS = [
  'merge',
  'dedupe',
  'conflict_audit',
  'rank_recommendations',
  'summarize',
] as const;

/**
 * Valid conflict severity values.
 */
export const CONFLICT_SEVERITIES = ['low', 'medium', 'high'] as const;

/**
 * Schema for SynthesisGoal type.
 */
export const SynthesisGoalSchema = z.enum(SYNTHESIS_GOALS);

/**
 * Schema for ConflictSeverity type.
 */
export const ConflictSeveritySchema = z.enum(CONFLICT_SEVERITIES);

/**
 * Schema for DetectedConflict objects.
 */
export const DetectedConflictSchema = z.object({
  topic: z.string(),
  sources_involved: z.array(z.string()),
  conflict_summary: z.string(),
  severity: ConflictSeveritySchema,
});

/**
 * Schema for SourcePreference objects.
 */
export const SourcePreferenceSchema = z.object({
  prefer_official_over_aggregators: z.boolean(),
  prefer_recent_when_time_sensitive: z.boolean(),
});

/**
 * Schema for SynthesisOutputFormat objects.
 */
export const SynthesisOutputFormatSchema = z.object({
  wants_table: z.boolean(),
  wants_actionable_summary: z.boolean(),
});

/**
 * Schema for SynthesisContext objects.
 */
export const SynthesisContextSchema = z.object({
  language: z.string(),
  domain: DomainSchema,
  mode: ModeSchema,
  synthesis_goals: z.array(SynthesisGoalSchema),
  missing_sections: z.array(z.string()),
  detected_conflicts: z.array(DetectedConflictSchema),
  source_preference: SourcePreferenceSchema,
  defaults_applied: z.array(DefaultAppliedSchema),
  assumptions: z.array(z.string()),
  output_format: SynthesisOutputFormatSchema,
  safety: SafetyInfoSchema,
  red_flags: z.array(z.string()),
});

// Export derived types
export type SynthesisGoal = z.infer<typeof SynthesisGoalSchema>;
export type ConflictSeverity = z.infer<typeof ConflictSeveritySchema>;
export type DetectedConflict = z.infer<typeof DetectedConflictSchema>;
export type SourcePreference = z.infer<typeof SourcePreferenceSchema>;
export type SynthesisOutputFormat = z.infer<typeof SynthesisOutputFormatSchema>;
export type SynthesisContext = z.infer<typeof SynthesisContextSchema>;

/**
 * Parameters for inferring synthesis context.
 */
export interface InferSynthesisContextParams {
  originalPrompt: string;
  reports?: LlmReport[] | undefined;
  additionalSources?: AdditionalSource[] | undefined;
  asOfDate?: string | undefined;
  defaultJurisdiction?: string | undefined;
  defaultCurrency?: string | undefined;
}
