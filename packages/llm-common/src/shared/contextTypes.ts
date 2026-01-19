/**
 * Shared types for the context inference system.
 * These types are used by both research and synthesis context inference.
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

export interface DefaultApplied {
  key: string;
  value: string | number | boolean;
  reason: string;
}

export interface SafetyInfo {
  high_stakes: boolean;
  required_disclaimers: string[];
}
