import { describe, expect, it } from 'vitest';
import { DOMAINS } from '../types.js';
import {
  isAnswerStyle,
  isAvoidSourceType,
  isConflictSeverity,
  isDefaultApplied,
  isDetectedConflict,
  isDomain,
  isLocaleScope,
  isMode,
  isOutputFormat,
  isResearchContext,
  isResearchPlan,
  isSafetyInfo,
  isSourcePreference,
  isSourceType,
  isSynthesisContext,
  isSynthesisGoal,
  isSynthesisOutputFormat,
  isTimeScope,
} from '../guards.js';

describe('DOMAINS constant', () => {
  it('exports all domain values', () => {
    expect(DOMAINS).toContain('travel');
    expect(DOMAINS).toContain('product');
    expect(DOMAINS).toContain('general');
    expect(DOMAINS).toContain('unknown');
    expect(DOMAINS.length).toBe(21);
  });
});

describe('isDomain', () => {
  it('returns true for valid domains', () => {
    expect(isDomain('travel')).toBe(true);
    expect(isDomain('product')).toBe(true);
    expect(isDomain('technical')).toBe(true);
    expect(isDomain('general')).toBe(true);
    expect(isDomain('unknown')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isDomain('invalid')).toBe(false);
    expect(isDomain(123)).toBe(false);
    expect(isDomain(null)).toBe(false);
    expect(isDomain(undefined)).toBe(false);
  });
});

describe('isMode', () => {
  it('returns true for valid modes', () => {
    expect(isMode('compact')).toBe(true);
    expect(isMode('standard')).toBe(true);
    expect(isMode('audit')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isMode('invalid')).toBe(false);
    expect(isMode(123)).toBe(false);
  });
});

describe('isAnswerStyle', () => {
  it('returns true for valid styles', () => {
    expect(isAnswerStyle('practical')).toBe(true);
    expect(isAnswerStyle('evidence_first')).toBe(true);
    expect(isAnswerStyle('step_by_step')).toBe(true);
    expect(isAnswerStyle('executive')).toBe(true);
    expect(isAnswerStyle('checklist')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isAnswerStyle('invalid')).toBe(false);
  });
});

describe('isSourceType', () => {
  it('returns true for valid source types', () => {
    expect(isSourceType('official')).toBe(true);
    expect(isSourceType('academic')).toBe(true);
    expect(isSourceType('community')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSourceType('invalid')).toBe(false);
  });
});

describe('isAvoidSourceType', () => {
  it('returns true for valid avoid types', () => {
    expect(isAvoidSourceType('random_blogs')).toBe(true);
    expect(isAvoidSourceType('seo_farms')).toBe(true);
    expect(isAvoidSourceType('unknown_affiliates')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isAvoidSourceType('invalid')).toBe(false);
  });
});

describe('isSynthesisGoal', () => {
  it('returns true for valid goals', () => {
    expect(isSynthesisGoal('merge')).toBe(true);
    expect(isSynthesisGoal('dedupe')).toBe(true);
    expect(isSynthesisGoal('conflict_audit')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSynthesisGoal('invalid')).toBe(false);
  });
});

describe('isConflictSeverity', () => {
  it('returns true for valid severities', () => {
    expect(isConflictSeverity('low')).toBe(true);
    expect(isConflictSeverity('medium')).toBe(true);
    expect(isConflictSeverity('high')).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isConflictSeverity('invalid')).toBe(false);
  });
});

describe('isDefaultApplied', () => {
  it('returns true for valid default applied', () => {
    expect(isDefaultApplied({ key: 'test', value: 'val', reason: 'why' })).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isDefaultApplied(null)).toBe(false);
    expect(isDefaultApplied({})).toBe(false);
    expect(isDefaultApplied({ key: 'test' })).toBe(false);
    expect(isDefaultApplied('string')).toBe(false);
  });
});

describe('isTimeScope', () => {
  it('returns true for valid time scope', () => {
    expect(
      isTimeScope({ as_of_date: '2024-01-01', prefers_recent_years: 2, is_time_sensitive: false })
    ).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isTimeScope(null)).toBe(false);
    expect(isTimeScope({})).toBe(false);
    expect(isTimeScope({ as_of_date: '2024' })).toBe(false);
  });
});

describe('isLocaleScope', () => {
  it('returns true for valid locale scope', () => {
    expect(isLocaleScope({ country_or_region: 'US', jurisdiction: 'US', currency: 'USD' })).toBe(
      true
    );
  });

  it('returns false for invalid values', () => {
    expect(isLocaleScope(null)).toBe(false);
    expect(isLocaleScope({ country_or_region: 'US' })).toBe(false);
  });
});

describe('isResearchPlan', () => {
  it('returns true for valid research plan', () => {
    expect(
      isResearchPlan({
        key_questions: ['q1'],
        search_queries: ['s1'],
        preferred_source_types: ['official'],
        avoid_source_types: ['random_blogs'],
      })
    ).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isResearchPlan(null)).toBe(false);
    expect(isResearchPlan({})).toBe(false);
    expect(isResearchPlan({ key_questions: 'not-array' })).toBe(false);
    expect(
      isResearchPlan({
        key_questions: ['q1'],
        search_queries: ['s1'],
        preferred_source_types: ['invalid'],
        avoid_source_types: [],
      })
    ).toBe(false);
  });
});

describe('isOutputFormat', () => {
  it('returns true for valid output format', () => {
    expect(
      isOutputFormat({
        wants_table: true,
        wants_steps: false,
        wants_pros_cons: true,
        wants_budget_numbers: false,
      })
    ).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isOutputFormat(null)).toBe(false);
    expect(isOutputFormat({ wants_table: true })).toBe(false);
  });
});

describe('isSafetyInfo', () => {
  it('returns true for valid safety info', () => {
    expect(isSafetyInfo({ high_stakes: true, required_disclaimers: ['test'] })).toBe(true);
    expect(isSafetyInfo({ high_stakes: false, required_disclaimers: [] })).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isSafetyInfo(null)).toBe(false);
    expect(isSafetyInfo({ high_stakes: true })).toBe(false);
  });
});

describe('isDetectedConflict', () => {
  it('returns true for valid detected conflict', () => {
    expect(
      isDetectedConflict({
        topic: 'topic',
        sources_involved: ['s1', 's2'],
        conflict_summary: 'summary',
        severity: 'high',
      })
    ).toBe(true);
  });

  it('returns false for invalid values', () => {
    expect(isDetectedConflict(null)).toBe(false);
    expect(isDetectedConflict({ topic: 'test' })).toBe(false);
    expect(
      isDetectedConflict({
        topic: 'topic',
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
    expect(isSourcePreference({ prefer_official_over_aggregators: true })).toBe(false);
  });
});

describe('isSynthesisOutputFormat', () => {
  it('returns true for valid synthesis output format', () => {
    expect(isSynthesisOutputFormat({ wants_table: true, wants_actionable_summary: false })).toBe(
      true
    );
  });

  it('returns false for invalid values', () => {
    expect(isSynthesisOutputFormat(null)).toBe(false);
    expect(isSynthesisOutputFormat({ wants_table: true })).toBe(false);
  });
});

describe('isResearchContext', () => {
  const validResearchContext = {
    language: 'en',
    domain: 'technical',
    mode: 'standard',
    intent_summary: 'Test intent',
    defaults_applied: [{ key: 'k', value: 'v', reason: 'r' }],
    assumptions: ['assumption'],
    answer_style: ['practical'],
    time_scope: { as_of_date: '2024-01-01', prefers_recent_years: 2, is_time_sensitive: false },
    locale_scope: { country_or_region: 'US', jurisdiction: 'US', currency: 'USD' },
    research_plan: {
      key_questions: ['q1'],
      search_queries: ['s1'],
      preferred_source_types: ['official'],
      avoid_source_types: ['random_blogs'],
    },
    output_format: {
      wants_table: false,
      wants_steps: false,
      wants_pros_cons: false,
      wants_budget_numbers: false,
    },
    safety: { high_stakes: false, required_disclaimers: [] },
    red_flags: [],
  };

  it('returns true for valid research context', () => {
    expect(isResearchContext(validResearchContext)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isResearchContext(null)).toBe(false);
  });

  it('returns false for missing fields', () => {
    expect(isResearchContext({ language: 'en' })).toBe(false);
  });

  it('returns false for invalid domain', () => {
    expect(isResearchContext({ ...validResearchContext, domain: 'invalid' })).toBe(false);
  });

  it('returns false for invalid defaults_applied', () => {
    expect(isResearchContext({ ...validResearchContext, defaults_applied: 'invalid' })).toBe(false);
  });

  it('returns false for invalid answer_style', () => {
    expect(isResearchContext({ ...validResearchContext, answer_style: ['invalid'] })).toBe(false);
  });
});

describe('isSynthesisContext', () => {
  const validSynthesisContext = {
    language: 'en',
    domain: 'technical',
    mode: 'standard',
    synthesis_goals: ['merge'],
    missing_sections: [],
    detected_conflicts: [],
    source_preference: {
      prefer_official_over_aggregators: true,
      prefer_recent_when_time_sensitive: false,
    },
    defaults_applied: [],
    assumptions: [],
    output_format: { wants_table: false, wants_actionable_summary: true },
    safety: { high_stakes: false, required_disclaimers: [] },
    red_flags: [],
  };

  it('returns true for valid synthesis context', () => {
    expect(isSynthesisContext(validSynthesisContext)).toBe(true);
  });

  it('returns true with detected conflicts', () => {
    const ctx = {
      ...validSynthesisContext,
      detected_conflicts: [
        {
          topic: 'topic',
          sources_involved: ['s1'],
          conflict_summary: 'summary',
          severity: 'medium',
        },
      ],
    };
    expect(isSynthesisContext(ctx)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isSynthesisContext(null)).toBe(false);
  });

  it('returns false for missing fields', () => {
    expect(isSynthesisContext({ language: 'en' })).toBe(false);
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
});
