import { describe, expect, it } from 'vitest';
import { buildInferResearchContextPrompt } from '../inferResearchContext.js';

describe('buildInferResearchContextPrompt', () => {
  it('includes user query in the prompt', () => {
    const result = buildInferResearchContextPrompt('What is machine learning?');

    expect(result).toContain('USER QUERY:');
    expect(result).toContain('What is machine learning?');
  });

  it('includes analysis instructions', () => {
    const result = buildInferResearchContextPrompt('test query');

    expect(result).toContain('ANALYSIS INSTRUCTIONS:');
    expect(result).toContain('Detect the language');
    expect(result).toContain('Identify the domain');
    expect(result).toContain('Determine the mode');
  });

  it('includes default values when no options provided', () => {
    const result = buildInferResearchContextPrompt('test query');

    expect(result).toContain('country_or_region: "United States"');
    expect(result).toContain('jurisdiction: "United States"');
    expect(result).toContain('currency: "USD"');
    expect(result).toContain('prefers_recent_years: 2');
  });

  it('uses custom options when provided', () => {
    const result = buildInferResearchContextPrompt('test query', {
      asOfDate: '2025-06-15',
      defaultCountryOrRegion: 'United Kingdom',
      defaultJurisdiction: 'England and Wales',
      defaultCurrency: 'GBP',
      prefersRecentYears: 5,
    });

    expect(result).toContain('as_of_date: "2025-06-15"');
    expect(result).toContain('country_or_region: "United Kingdom"');
    expect(result).toContain('jurisdiction: "England and Wales"');
    expect(result).toContain('currency: "GBP"');
    expect(result).toContain('prefers_recent_years: 5');
  });

  it('includes domain options', () => {
    const result = buildInferResearchContextPrompt('test query');

    expect(result).toContain('DOMAIN OPTIONS:');
    expect(result).toContain('travel');
    expect(result).toContain('product');
    expect(result).toContain('technical');
    expect(result).toContain('medical');
  });

  it('includes mode rules', () => {
    const result = buildInferResearchContextPrompt('test query');

    expect(result).toContain('MODE RULES:');
    expect(result).toContain('compact');
    expect(result).toContain('standard');
    expect(result).toContain('audit');
  });

  it('includes answer style options', () => {
    const result = buildInferResearchContextPrompt('test query');

    expect(result).toContain('ANSWER_STYLE OPTIONS');
    expect(result).toContain('practical');
    expect(result).toContain('evidence_first');
    expect(result).toContain('step_by_step');
  });

  it('includes source type options', () => {
    const result = buildInferResearchContextPrompt('test query');

    expect(result).toContain('PREFERRED_SOURCE_TYPES OPTIONS:');
    expect(result).toContain('official');
    expect(result).toContain('academic');
    expect(result).toContain('AVOID_SOURCE_TYPES OPTIONS:');
    expect(result).toContain('random_blogs');
  });

  it('requests strict JSON output', () => {
    const result = buildInferResearchContextPrompt('test query');

    expect(result).toContain('OUTPUT STRICT JSON (no markdown, no explanation)');
    expect(result).toContain('"language":');
    expect(result).toContain('"domain":');
    expect(result).toContain('"research_plan":');
  });

  it('includes as_of_date from current date when not specified', () => {
    const result = buildInferResearchContextPrompt('test query');
    const today = new Date().toISOString().split('T')[0];

    expect(result).toContain(`as_of_date: "${today ?? ''}"`);
  });
});
