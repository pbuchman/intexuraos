/**
 * Types specific to research context inference.
 */

import type { DefaultApplied, Domain, Mode, SafetyInfo } from '../shared/contextTypes.js';

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

export interface InferResearchContextOptions {
  asOfDate?: string | undefined;
  defaultCountryOrRegion?: string | undefined;
  defaultJurisdiction?: string | undefined;
  defaultCurrency?: string | undefined;
  prefersRecentYears?: number | undefined;
}
