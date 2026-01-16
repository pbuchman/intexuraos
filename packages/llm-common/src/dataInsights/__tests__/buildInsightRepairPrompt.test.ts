import { describe, it, expect } from 'vitest';
import { buildInsightRepairPrompt } from '../buildInsightRepairPrompt.js';

describe('buildInsightRepairPrompt', () => {
  it('builds repair prompt with all required sections', () => {
    const originalPrompt = 'Analyze this data and find insights';
    const invalidResponse =
      'INSIGHT_1: Title=Bad; Description=Too many sentences. One. Two. Three. Four.';
    const errorMessage = 'Line 1: Description must be max 3 sentences, got 4';

    const result = buildInsightRepairPrompt(originalPrompt, invalidResponse, errorMessage);

    expect(result).toContain('ORIGINAL PROMPT:');
    expect(result).toContain(originalPrompt);
    expect(result).toContain('ERROR DETAILS:');
    expect(result).toContain(errorMessage);
    expect(result).toContain('INVALID RESPONSE:');
    expect(result).toContain(invalidResponse);
    expect(result).toContain('REQUIREMENTS:');
    expect(result).toContain('Description must be MAX 3 sentences');
    expect(result).toContain('ChartType must be exactly one of: C1, C2, C3, C4, C5, C6');
  });

  it('includes valid output examples', () => {
    const result = buildInsightRepairPrompt('prompt', 'response', 'error');

    expect(result).toContain('EXAMPLES OF VALID OUTPUT:');
    expect(result).toContain('INSIGHT_1:');
    expect(result).toContain('Title=Monthly Revenue Growth');
    expect(result).toContain('ChartType=C2');
  });

  it('includes invalid output examples', () => {
    const result = buildInsightRepairPrompt('prompt', 'response', 'error');

    expect(result).toContain('EXAMPLES OF INVALID OUTPUT:');
    expect(result).toContain('Description with 4+ sentences');
    expect(result).toContain('ChartType=Bar');
  });

  it('includes NO_INSIGHTS format instruction', () => {
    const result = buildInsightRepairPrompt('prompt', 'response', 'error');

    expect(result).toContain('NO_INSIGHTS: Reason=<explanation>');
  });

  it('preserves multi-line original prompt', () => {
    const originalPrompt = `First line
Second line
Third line`;
    const result = buildInsightRepairPrompt(originalPrompt, 'response', 'error');

    expect(result).toContain('First line');
    expect(result).toContain('Second line');
    expect(result).toContain('Third line');
  });

  it('preserves special characters in error message', () => {
    const errorMessage = 'Line 4: Description "test" has > 3 sentences & < 1 valid';
    const result = buildInsightRepairPrompt('prompt', 'response', errorMessage);

    expect(result).toContain(errorMessage);
  });
});
