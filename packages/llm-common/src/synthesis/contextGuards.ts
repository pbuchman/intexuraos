/**
 * Runtime type guards for synthesis context inference.
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
  ConflictSeverity,
  DetectedConflict,
  SourcePreference,
  SynthesisContext,
  SynthesisGoal,
  SynthesisOutputFormat,
} from './contextTypes.js';

const SYNTHESIS_GOALS: SynthesisGoal[] = [
  'merge',
  'dedupe',
  'conflict_audit',
  'rank_recommendations',
  'summarize',
];

const CONFLICT_SEVERITIES: ConflictSeverity[] = ['low', 'medium', 'high'];

export function isSynthesisGoal(value: unknown): value is SynthesisGoal {
  return typeof value === 'string' && SYNTHESIS_GOALS.includes(value as SynthesisGoal);
}

export function isConflictSeverity(value: unknown): value is ConflictSeverity {
  return typeof value === 'string' && CONFLICT_SEVERITIES.includes(value as ConflictSeverity);
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
