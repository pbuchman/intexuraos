/**
 * Runtime type guards for research context inference.
 *
 * Type guards use Zod schemas internally for validation.
 */

import { isObject, isStringArray } from '../shared/contextGuards.js';
import type {
  AnswerStyle,
  AvoidSourceType,
  LocaleScope,
  OutputFormat,
  ResearchContext,
  ResearchPlan,
  SourceType,
  TimeScope,
} from './contextSchemas.js';
import {
  AnswerStyleSchema,
  AvoidSourceTypeSchema,
  LocaleScopeSchema,
  OutputFormatSchema,
  ResearchContextSchema,
  ResearchPlanSchema,
  SourceTypeSchema,
  TimeScopeSchema,
} from './contextSchemas.js';

export function isAnswerStyle(value: unknown): value is AnswerStyle {
  return AnswerStyleSchema.safeParse(value).success;
}

export function isSourceType(value: unknown): value is SourceType {
  return SourceTypeSchema.safeParse(value).success;
}

export function isAvoidSourceType(value: unknown): value is AvoidSourceType {
  return AvoidSourceTypeSchema.safeParse(value).success;
}

export function isTimeScope(value: unknown): value is TimeScope {
  return TimeScopeSchema.safeParse(value).success;
}

export function isLocaleScope(value: unknown): value is LocaleScope {
  return LocaleScopeSchema.safeParse(value).success;
}

export function isResearchPlan(value: unknown): value is ResearchPlan {
  return ResearchPlanSchema.safeParse(value).success;
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  return OutputFormatSchema.safeParse(value).success;
}

export function isResearchContext(value: unknown): value is ResearchContext {
  return ResearchContextSchema.safeParse(value).success;
}

// Re-export utilities used in tests
export { isObject, isStringArray };
