import { describe, expect, it } from 'vitest';
import {
  isSynthesisGoal,
  isConflictSeverity,
  isDetectedConflict,
  isSourcePreference,
  isSynthesisOutputFormat,
  isSynthesisContext,
} from '../contextGuards.js';

describe('isSynthesisGoal', () => {
  it('returns true for valid synthesis goals', () => {
    expect(isSynthesisGoal('merge')).toBe(true);
    expect(isSynthesisGoal('dedupe')).toBe(true);
    expect(isSynthesisGoal('conflict_audit')).toBe(true);
    expect(isSynthesisGoal('rank_recommendations')).toBe(true);
    expect(isSynthesisGoal('summarize')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSynthesisGoal('invalid')).toBe(false);
    expect(isSynthesisGoal(123)).toBe(false);
    expect(isSynthesisGoal(null)).toBe(false);
  });
});

describe('isConflictSeverity', () => {
  it('returns true for valid severities', () => {
    expect(isConflictSeverity('low')).toBe(true);
    expect(isConflictSeverity('medium')).toBe(true);
    expect(isConflictSeverity('high')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isConflictSeverity('critical')).toBe(false);
    expect(isConflictSeverity(1)).toBe(false);
  });
});

describe('isDetectedConflict', () => {
  it('returns true for valid detected conflict', () => {
    expect(
      isDetectedConflict({
        topic: 'pricing',
        sources_involved: ['source1', 'source2'],
        conflict_summary: 'Different prices reported',
        severity: 'medium',
      })
    ).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isDetectedConflict(null)).toBe(false);
    expect(isDetectedConflict({})).toBe(false);
    expect(isDetectedConflict({ topic: 'test' })).toBe(false);
    expect(
      isDetectedConflict({
        topic: 'test',
        sources_involved: 'not-array',
        conflict_summary: 'summary',
        severity: 'low',
      })
    ).toBe(false);
    expect(
      isDetectedConflict({
        topic: 'test',
        sources_involved: ['s1'],
        conflict_summary: 'summary',
        severity: 'invalid',
      })
    ).toBe(false);
  });
});

describe('isSourcePreference', () => {
  it('returns true for valid source preference', () => {
    expect(
      isSourcePreference({
        prefer_official_over_aggregators: true,
        prefer_recent_when_time_sensitive: false,
      })
    ).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSourcePreference(null)).toBe(false);
    expect(isSourcePreference({})).toBe(false);
    expect(isSourcePreference({ prefer_official_over_aggregators: true })).toBe(false);
  });
});

describe('isSynthesisOutputFormat', () => {
  it('returns true for valid output format', () => {
    expect(
      isSynthesisOutputFormat({
        wants_table: true,
        wants_actionable_summary: false,
      })
    ).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSynthesisOutputFormat(null)).toBe(false);
    expect(isSynthesisOutputFormat({ wants_table: true })).toBe(false);
  });
});

describe('isSynthesisContext', () => {
  const validSynthesisContext = {
    language: 'en',
    domain: 'technical',
    mode: 'standard',
    synthesis_goals: ['merge', 'dedupe'],
    missing_sections: ['pricing'],
    detected_conflicts: [
      {
        topic: 'availability',
        sources_involved: ['source1', 'source2'],
        conflict_summary: 'Different availability info',
        severity: 'low',
      },
    ],
    source_preference: {
      prefer_official_over_aggregators: true,
      prefer_recent_when_time_sensitive: true,
    },
    defaults_applied: [{ key: 'k', value: 'v', reason: 'r' }],
    assumptions: ['assumption1'],
    output_format: {
      wants_table: false,
      wants_actionable_summary: true,
    },
    safety: { high_stakes: false, required_disclaimers: [] },
    red_flags: [],
  };

  it('returns true for valid synthesis context', () => {
    expect(isSynthesisContext(validSynthesisContext)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isSynthesisContext(null)).toBe(false);
  });

  it('returns false for missing fields', () => {
    expect(isSynthesisContext({ language: 'en' })).toBe(false);
  });

  it('returns false for invalid domain', () => {
    expect(isSynthesisContext({ ...validSynthesisContext, domain: 'invalid' })).toBe(false);
  });

  it('returns false for invalid synthesis_goals', () => {
    expect(isSynthesisContext({ ...validSynthesisContext, synthesis_goals: ['invalid'] })).toBe(
      false
    );
  });

  it('returns false for invalid detected_conflicts', () => {
    expect(
      isSynthesisContext({ ...validSynthesisContext, detected_conflicts: [{ invalid: true }] })
    ).toBe(false);
  });

  it('returns false for invalid source_preference', () => {
    expect(isSynthesisContext({ ...validSynthesisContext, source_preference: {} })).toBe(false);
  });

  it('returns false for invalid output_format', () => {
    expect(isSynthesisContext({ ...validSynthesisContext, output_format: {} })).toBe(false);
  });
});
