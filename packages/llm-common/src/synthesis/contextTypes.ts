/**
 * Types specific to synthesis context inference.
 */

import type { DefaultApplied, Domain, Mode, SafetyInfo } from '../shared/contextTypes.js';
import type {
  AdditionalSource,
  SynthesisReport as LlmReport,
} from '../research/synthesisPrompt.js';

export type { AdditionalSource, LlmReport };

export type SynthesisGoal =
  | 'merge'
  | 'dedupe'
  | 'conflict_audit'
  | 'rank_recommendations'
  | 'summarize';

export type ConflictSeverity = 'low' | 'medium' | 'high';

export interface DetectedConflict {
  topic: string;
  sources_involved: string[];
  conflict_summary: string;
  severity: ConflictSeverity;
}

export interface SourcePreference {
  prefer_official_over_aggregators: boolean;
  prefer_recent_when_time_sensitive: boolean;
}

export interface SynthesisOutputFormat {
  wants_table: boolean;
  wants_actionable_summary: boolean;
}

export interface SynthesisContext {
  language: string;
  domain: Domain;
  mode: Mode;
  synthesis_goals: SynthesisGoal[];
  missing_sections: string[];
  detected_conflicts: DetectedConflict[];
  source_preference: SourcePreference;
  defaults_applied: DefaultApplied[];
  assumptions: string[];
  output_format: SynthesisOutputFormat;
  safety: SafetyInfo;
  red_flags: string[];
}

export interface InferSynthesisContextParams {
  originalPrompt: string;
  reports?: LlmReport[] | undefined;
  additionalSources?: AdditionalSource[] | undefined;
  asOfDate?: string | undefined;
  defaultJurisdiction?: string | undefined;
  defaultCurrency?: string | undefined;
}
