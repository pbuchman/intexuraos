import { describe, expect, it } from 'vitest';
import {
  isAnswerStyle,
  isSourceType,
  isAvoidSourceType,
  isTimeScope,
  isLocaleScope,
  isResearchPlan,
  isOutputFormat,
  isResearchContext,
} from '../contextGuards.js';

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
