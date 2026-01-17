/**
 * Runtime type guards for research context inference.
 */

import {
  isDefaultApplied,
  isDomain,
  isMode,
  isObject,
  isSafetyInfo,
  isStringArray,
} from '../shared/contextGuards.js';
import type {
  AnswerStyle,
  AvoidSourceType,
  LocaleScope,
  OutputFormat,
  ResearchContext,
  ResearchPlan,
  SourceType,
  TimeScope,
} from './contextTypes.js';

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

export function isAnswerStyle(value: unknown): value is AnswerStyle {
  return typeof value === 'string' && ANSWER_STYLES.includes(value as AnswerStyle);
}

export function isSourceType(value: unknown): value is SourceType {
  return typeof value === 'string' && SOURCE_TYPES.includes(value as SourceType);
}

export function isAvoidSourceType(value: unknown): value is AvoidSourceType {
  return typeof value === 'string' && AVOID_SOURCE_TYPES.includes(value as AvoidSourceType);
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
