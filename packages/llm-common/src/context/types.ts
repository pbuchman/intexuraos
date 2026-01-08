/**
 * Types for the two-phase context inference system.
 * Phase 1: Infer context from user query
 * Phase 2: Build targeted prompts using the inferred context
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
  'diy_home',
  'general',
  'unknown',
] as const;

export type Domain =
  | 'travel'
  | 'product'
  | 'technical'
  | 'legal'
  | 'medical'
  | 'financial'
  | 'security_privacy'
  | 'business_strategy'
  | 'marketing_sales'
  | 'hr_people_ops'
  | 'education_learning'
  | 'science_research'
  | 'history_culture'
  | 'politics_policy'
  | 'real_estate'
  | 'food_nutrition'
  | 'fitness_sports'
  | 'entertainment_media'
  | 'diy_home'
  | 'general'
  | 'unknown';

export type Mode = 'compact' | 'standard' | 'audit';

export type AnswerStyle =
  | 'practical'
  | 'evidence_first'
  | 'step_by_step'
  | 'executive'
  | 'checklist';

export type SourceType =
  | 'official'
  | 'primary_docs'
  | 'regulators'
  | 'manufacturers'
  | 'academic'
  | 'reputable_media'
  | 'community';

export type AvoidSourceType = 'random_blogs' | 'seo_farms' | 'unknown_affiliates';

export type SynthesisGoal =
  | 'merge'
  | 'dedupe'
  | 'conflict_audit'
  | 'rank_recommendations'
  | 'summarize';

export type ConflictSeverity = 'low' | 'medium' | 'high';

export interface DefaultApplied {
  key: string;
  value: string;
  reason: string;
}

export interface TimeScope {
  as_of_date: string;
  prefers_recent_years: number;
  is_time_sensitive: boolean;
}

export interface LocaleScope {
  country_or_region: string;
  jurisdiction: string;
  currency: string;
}

export interface ResearchPlan {
  key_questions: string[];
  search_queries: string[];
  preferred_source_types: SourceType[];
  avoid_source_types: AvoidSourceType[];
}

export interface OutputFormat {
  wants_table: boolean;
  wants_steps: boolean;
  wants_pros_cons: boolean;
  wants_budget_numbers: boolean;
}

export interface SafetyInfo {
  high_stakes: boolean;
  required_disclaimers: string[];
}

export interface ResearchContext {
  language: string;
  domain: Domain;
  mode: Mode;
  intent_summary: string;
  defaults_applied: DefaultApplied[];
  assumptions: string[];
  answer_style: AnswerStyle[];
  time_scope: TimeScope;
  locale_scope: LocaleScope;
  research_plan: ResearchPlan;
  output_format: OutputFormat;
  safety: SafetyInfo;
  red_flags: string[];
}

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

export interface LlmReport {
  model: string;
  content: string;
}

export interface AdditionalSource {
  content: string;
  label?: string | undefined;
}

export interface InferResearchContextOptions {
  asOfDate?: string | undefined;
  defaultCountryOrRegion?: string | undefined;
  defaultJurisdiction?: string | undefined;
  defaultCurrency?: string | undefined;
  prefersRecentYears?: number | undefined;
}

export interface InferSynthesisContextParams {
  originalPrompt: string;
  reports?: LlmReport[] | undefined;
  additionalSources?: AdditionalSource[] | undefined;
  asOfDate?: string | undefined;
  defaultJurisdiction?: string | undefined;
  defaultCurrency?: string | undefined;
}
