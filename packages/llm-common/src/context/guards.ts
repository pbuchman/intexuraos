/**
 * Runtime type guards for context inference types.
 */

import type {
  AnswerStyle,
  AvoidSourceType,
  ConflictSeverity,
  DefaultApplied,
  DetectedConflict,
  Domain,
  LocaleScope,
  Mode,
  OutputFormat,
  ResearchContext,
  ResearchPlan,
  SafetyInfo,
  SourcePreference,
  SourceType,
  SynthesisContext,
  SynthesisGoal,
  SynthesisOutputFormat,
  TimeScope,
} from './types.js';

const DOMAINS: Domain[] = [
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
];

const MODES: Mode[] = ['compact', 'standard', 'audit'];

const ANSWER_STYLES: AnswerStyle[] = [
  'practical',
  'evidence_first',
  'step_by_step',
  'executive',
  'checklist',
];

const SOURCE_TYPES: SourceType[] = [
  'official',
  'primary_docs',
  'regulators',
  'manufacturers',
  'academic',
  'reputable_media',
  'community',
];

const AVOID_SOURCE_TYPES: AvoidSourceType[] = ['random_blogs', 'seo_farms', 'unknown_affiliates'];

const SYNTHESIS_GOALS: SynthesisGoal[] = [
  'merge',
  'dedupe',
  'conflict_audit',
  'rank_recommendations',
  'summarize',
];

const CONFLICT_SEVERITIES: ConflictSeverity[] = ['low', 'medium', 'high'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && DOMAINS.includes(value as Domain);
}

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && MODES.includes(value as Mode);
}

export function isAnswerStyle(value: unknown): value is AnswerStyle {
  return typeof value === 'string' && ANSWER_STYLES.includes(value as AnswerStyle);
}

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === 'string' && SOURCE_TYPES.includes(value as SourceType);
}

export function isAvoidSourceType(value: unknown): value is AvoidSourceType {
  return typeof value === 'string' && AVOID_SOURCE_TYPES.includes(value as AvoidSourceType);
}

export function isSynthesisGoal(value: unknown): value is SynthesisGoal {
  return typeof value === 'string' && SYNTHESIS_GOALS.includes(value as SynthesisGoal);
}

export function isConflictSeverity(value: unknown): value is ConflictSeverity {
  return typeof value === 'string' && CONFLICT_SEVERITIES.includes(value as ConflictSeverity);
}

export function isDefaultApplied(value: unknown): value is DefaultApplied {
  if (!isObject(value)) return false;
  return (
    typeof value['key'] === 'string' &&
    typeof value['value'] === 'string' &&
    typeof value['reason'] === 'string'
  );
}

export function isTimeScope(value: unknown): value is TimeScope {
  if (!isObject(value)) return false;
  return (
    typeof value['as_of_date'] === 'string' &&
    typeof value['prefers_recent_years'] === 'number' &&
    typeof value['is_time_sensitive'] === 'boolean'
  );
}

export function isLocaleScope(value: unknown): value is LocaleScope {
  if (!isObject(value)) return false;
  return (
    typeof value['country_or_region'] === 'string' &&
    typeof value['jurisdiction'] === 'string' &&
    typeof value['currency'] === 'string'
  );
}

export function isResearchPlan(value: unknown): value is ResearchPlan {
  if (!isObject(value)) return false;
  const keyQuestions = value['key_questions'];
  const searchQueries = value['search_queries'];
  const preferredSourceTypes = value['preferred_source_types'];
  const avoidSourceTypes = value['avoid_source_types'];
  return (
    isStringArray(keyQuestions) &&
    isStringArray(searchQueries) &&
    Array.isArray(preferredSourceTypes) &&
    preferredSourceTypes.every(isSourceType) &&
    Array.isArray(avoidSourceTypes) &&
    avoidSourceTypes.every(isAvoidSourceType)
  );
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  if (!isObject(value)) return false;
  return (
    typeof value['wants_table'] === 'boolean' &&
    typeof value['wants_steps'] === 'boolean' &&
    typeof value['wants_pros_cons'] === 'boolean' &&
    typeof value['wants_budget_numbers'] === 'boolean'
  );
}

export function isSafetyInfo(value: unknown): value is SafetyInfo {
  if (!isObject(value)) return false;
  const disclaimers = value['required_disclaimers'];
  return typeof value['high_stakes'] === 'boolean' && isStringArray(disclaimers);
}

export function isResearchContext(value: unknown): value is ResearchContext {
  if (!isObject(value)) return false;

  const defaultsApplied = value['defaults_applied'];
  const assumptions = value['assumptions'];
  const answerStyle = value['answer_style'];
  const redFlags = value['red_flags'];

  return (
    typeof value['language'] === 'string' &&
    isDomain(value['domain']) &&
    isMode(value['mode']) &&
    typeof value['intent_summary'] === 'string' &&
    Array.isArray(defaultsApplied) &&
    defaultsApplied.every(isDefaultApplied) &&
    isStringArray(assumptions) &&
    Array.isArray(answerStyle) &&
    answerStyle.every(isAnswerStyle) &&
    isTimeScope(value['time_scope']) &&
    isLocaleScope(value['locale_scope']) &&
    isResearchPlan(value['research_plan']) &&
    isOutputFormat(value['output_format']) &&
    isSafetyInfo(value['safety']) &&
    isStringArray(redFlags)
  );
}

export function isDetectedConflict(value: unknown): value is DetectedConflict {
  if (!isObject(value)) return false;
  const sourcesInvolved = value['sources_involved'];
  return (
    typeof value['topic'] === 'string' &&
    isStringArray(sourcesInvolved) &&
    typeof value['conflict_summary'] === 'string' &&
    isConflictSeverity(value['severity'])
  );
}

export function isSourcePreference(value: unknown): value is SourcePreference {
  if (!isObject(value)) return false;
  return (
    typeof value['prefer_official_over_aggregators'] === 'boolean' &&
    typeof value['prefer_recent_when_time_sensitive'] === 'boolean'
  );
}

export function isSynthesisOutputFormat(value: unknown): value is SynthesisOutputFormat {
  if (!isObject(value)) return false;
  return (
    typeof value['wants_table'] === 'boolean' &&
    typeof value['wants_actionable_summary'] === 'boolean'
  );
}

export function isSynthesisContext(value: unknown): value is SynthesisContext {
  if (!isObject(value)) return false;

  const synthesisGoals = value['synthesis_goals'];
  const missingSections = value['missing_sections'];
  const detectedConflicts = value['detected_conflicts'];
  const defaultsApplied = value['defaults_applied'];
  const assumptions = value['assumptions'];
  const redFlags = value['red_flags'];

  return (
    typeof value['language'] === 'string' &&
    isDomain(value['domain']) &&
    isMode(value['mode']) &&
    Array.isArray(synthesisGoals) &&
    synthesisGoals.every(isSynthesisGoal) &&
    isStringArray(missingSections) &&
    Array.isArray(detectedConflicts) &&
    detectedConflicts.every(isDetectedConflict) &&
    isSourcePreference(value['source_preference']) &&
    Array.isArray(defaultsApplied) &&
    defaultsApplied.every(isDefaultApplied) &&
    isStringArray(assumptions) &&
    isSynthesisOutputFormat(value['output_format']) &&
    isSafetyInfo(value['safety']) &&
    isStringArray(redFlags)
  );
}
