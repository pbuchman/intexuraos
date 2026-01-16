/**
 * Shared runtime type guards for context inference.
 * These guards are used by both research and synthesis context inference.
 */

import type { DefaultApplied, Domain, Mode, SafetyInfo } from './contextTypes.js';

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

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDomain(value: unknown): value is Domain {
  return typeof value === 'string' && DOMAINS.includes(value as Domain);
}

export function isMode(value: unknown): value is Mode {
  return typeof value === 'string' && MODES.includes(value as Mode);
}

export function isDefaultApplied(value: unknown): value is DefaultApplied {
  if (!isObject(value)) return false;
  return (
    typeof value['key'] === 'string' &&
    typeof value['value'] === 'string' &&
    typeof value['reason'] === 'string'
  );
}

export function isSafetyInfo(value: unknown): value is SafetyInfo {
  if (!isObject(value)) return false;
  const disclaimers = value['required_disclaimers'];
  return typeof value['high_stakes'] === 'boolean' && isStringArray(disclaimers);
}
