import { describe, it, expect } from 'vitest';
import { buildInsightRepairPrompt } from '../buildInsightRepairPrompt.js';
import { DEFAULT_CHART_IDS } from '../parseInsightResponse.js';

describe('buildInsightRepairPrompt', () => {
  it('builds repair prompt with all required sections', () => {
    const originalPrompt = 'Analyze this data and find insights';
    const invalidResponse =
      'INSIGHT_1: Title=Bad; Description=One. Two. Three. Four. Five. Six. Seven.';
    const errorMessage = 'Line 1: Description must be max 6 sentences, got 7';

    const result = buildInsightRepairPrompt(originalPrompt, invalidResponse, errorMessage);

    expect(result).toContain('ORIGINAL PROMPT:');
    expect(result).toContain(originalPrompt);
    expect(result).toContain('ERROR DETAILS:');
    expect(result).toContain(errorMessage);
    expect(result).toContain('INVALID RESPONSE:');
    expect(result).toContain(invalidResponse);
    expect(result).toContain('REQUIREMENTS:');
    expect(result).toContain('2-3 sentences maximum');
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
    expect(result).toContain(
      'Description with 7+ sentences (parser tolerates up to 6 but target is 2-3)'
    );
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

  describe('chart ID contract unification', () => {
    it('uses DEFAULT_CHART_IDS when no validChartIds provided', () => {
      const result = buildInsightRepairPrompt('prompt', 'response', 'error');

      expect(result).toContain(`ChartType must be exactly one of: ${DEFAULT_CHART_IDS.join(', ')}`);
    });

    it('uses custom chart IDs when provided', () => {
      const customIds = ['BAR', 'LINE', 'PIE'];
      const result = buildInsightRepairPrompt('prompt', 'response', 'error', customIds);

      expect(result).toContain('ChartType must be exactly one of: BAR, LINE, PIE');
      expect(result).not.toContain('C1, C2, C3, C4, C5, C6');
    });

    it('includes custom chart IDs in INSIGHT format line', () => {
      const customIds = ['X1', 'X2'];
      const result = buildInsightRepairPrompt('prompt', 'response', 'error', customIds);

      expect(result).toContain(`ChartType=<${customIds.join('|')}>`);
    });

    it('includes custom chart IDs in invalid output examples', () => {
      const customIds = ['BAR', 'LINE'];
      const result = buildInsightRepairPrompt('prompt', 'response', 'error', customIds);

      expect(result).toContain(`must use ${customIds.join('|')} codes`);
    });
  });
});
