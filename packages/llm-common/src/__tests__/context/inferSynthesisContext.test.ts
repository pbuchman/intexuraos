import { describe, expect, it } from 'vitest';
import { buildInferSynthesisContextPrompt } from '../../context/inferSynthesisContext.js';

describe('buildInferSynthesisContextPrompt', () => {
  it('includes original prompt', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'What is the best laptop?',
    });

    expect(result).toContain('ORIGINAL USER QUERY:');
    expect(result).toContain('What is the best laptop?');
  });

  it('includes LLM reports when provided', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
      reports: [
        { model: 'GPT-4', content: 'GPT-4 analysis content' },
        { model: 'Claude', content: 'Claude analysis content' },
      ],
    });

    expect(result).toContain('LLM RESEARCH REPORTS:');
    expect(result).toContain('=== GPT-4 ===');
    expect(result).toContain('GPT-4 analysis content');
    expect(result).toContain('=== Claude ===');
    expect(result).toContain('Claude analysis content');
  });

  it('shows message when no reports provided', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
    });

    expect(result).toContain('(No LLM reports provided)');
  });

  it('includes additional sources when provided', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
      additionalSources: [
        { content: 'Source 1 content', label: 'Perplexity' },
        { content: 'Source 2 content' },
      ],
    });

    expect(result).toContain('ADDITIONAL SOURCES:');
    expect(result).toContain('=== Source 1: Perplexity ===');
    expect(result).toContain('Source 1 content');
    expect(result).toContain('=== Source 2 ===');
    expect(result).toContain('Source 2 content');
  });

  it('includes default values', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
    });

    expect(result).toContain('jurisdiction: "United States"');
    expect(result).toContain('currency: "USD"');
  });

  it('uses custom options when provided', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
      asOfDate: '2025-12-01',
      defaultJurisdiction: 'Germany',
      defaultCurrency: 'EUR',
    });

    expect(result).toContain('as_of_date: "2025-12-01"');
    expect(result).toContain('jurisdiction: "Germany"');
    expect(result).toContain('currency: "EUR"');
  });

  it('includes analysis instructions', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
    });

    expect(result).toContain('ANALYSIS INSTRUCTIONS:');
    expect(result).toContain('Detect the primary language');
    expect(result).toContain('Identify synthesis goals');
    expect(result).toContain('Detect conflicts between sources');
  });

  it('includes domain options', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
    });

    expect(result).toContain('DOMAIN OPTIONS:');
    expect(result).toContain('travel');
    expect(result).toContain('technical');
  });

  it('includes synthesis goal options', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
    });

    expect(result).toContain('SYNTHESIS_GOALS OPTIONS');
    expect(result).toContain('merge');
    expect(result).toContain('dedupe');
    expect(result).toContain('conflict_audit');
  });

  it('includes conflict severity options', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
    });

    expect(result).toContain('CONFLICT SEVERITY:');
    expect(result).toContain('low');
    expect(result).toContain('medium');
    expect(result).toContain('high');
  });

  it('requests strict JSON output', () => {
    const result = buildInferSynthesisContextPrompt({
      originalPrompt: 'test query',
    });

    expect(result).toContain('OUTPUT STRICT JSON (no markdown, no explanation)');
    expect(result).toContain('"language":');
    expect(result).toContain('"synthesis_goals":');
    expect(result).toContain('"detected_conflicts":');
  });
});
