/**
 * Runtime type guards for synthesis context inference.
 *
 * Type guards use Zod schemas internally for validation.
 */

import { isObject, isStringArray } from '../shared/contextGuards.js';
import type {
  ConflictSeverity,
  DetectedConflict,
  SourcePreference,
  SynthesisContext,
  SynthesisGoal,
  SynthesisOutputFormat,
} from './contextSchemas.js';
import {
  ConflictSeveritySchema,
  DetectedConflictSchema,
  SourcePreferenceSchema,
  SynthesisContextSchema,
  SynthesisGoalSchema,
  SynthesisOutputFormatSchema,
} from './contextSchemas.js';

export function isSynthesisGoal(value: unknown): value is SynthesisGoal {
  return SynthesisGoalSchema.safeParse(value).success;
}

export function isConflictSeverity(value: unknown): value is ConflictSeverity {
  return ConflictSeveritySchema.safeParse(value).success;
}

export function isDetectedConflict(value: unknown): value is DetectedConflict {
  return DetectedConflictSchema.safeParse(value).success;
}

export function isSourcePreference(value: unknown): value is SourcePreference {
  return SourcePreferenceSchema.safeParse(value).success;
}

export function isSynthesisOutputFormat(value: unknown): value is SynthesisOutputFormat {
  return SynthesisOutputFormatSchema.safeParse(value).success;
}

export function isSynthesisContext(value: unknown): value is SynthesisContext {
  return SynthesisContextSchema.safeParse(value).success;
}

// Re-export utilities used in tests
export { isObject, isStringArray };
