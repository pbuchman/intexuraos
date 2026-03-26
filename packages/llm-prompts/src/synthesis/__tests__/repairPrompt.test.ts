import { describe, expect, it } from 'vitest';
import { buildSynthesisContextRepairPrompt } from '../repairPrompt.js';

describe('buildSynthesisContextRepairPrompt', () => {
  it('includes original prompt in XML tags', () => {
    const result = buildSynthesisContextRepairPrompt('test query', '{}', 'some error');

    expect(result).toContain('<user_query>');
    expect(result).toContain('test query');
    expect(result).toContain('</user_query>');
  });

  it('includes invalid response in XML tags', () => {
    const result = buildSynthesisContextRepairPrompt('query', '{bad json}', 'parse error');

    expect(result).toContain('<invalid_response>');
    expect(result).toContain('{bad json}');
    expect(result).toContain('</invalid_response>');
  });

  it('includes error message', () => {
    const result = buildSynthesisContextRepairPrompt('query', '{}', 'missing field: domain');

    expect(result).toContain('ERROR DETAILS:');
    expect(result).toContain('missing field: domain');
  });

  it('includes JSON schema requirements', () => {
    const result = buildSynthesisContextRepairPrompt('query', '{}', 'error');

    expect(result).toContain('EXPECTED SCHEMA:');
    expect(result).toContain('"domain"');
    expect(result).toContain('"synthesis_goals"');
    expect(result).toContain('"detected_conflicts"');
  });

  it('includes JSON formatting rules', () => {
    const result = buildSynthesisContextRepairPrompt('query', '{}', 'error');

    expect(result).toContain('Output ONLY valid JSON');
    expect(result).toContain('No trailing commas');
  });

  it('should include outdoor_recreation and fishing in domain list', () => {
    const result = buildSynthesisContextRepairPrompt('query', '{}', 'error');
    expect(result).toContain('outdoor_recreation');
    expect(result).toContain('fishing');
    expect(result).toContain('construction_building');
  });

  it('should include user_exclusions in safety schema', () => {
    const result = buildSynthesisContextRepairPrompt('query', '{}', 'error');
    expect(result).toContain('user_exclusions');
  });

  it('preserves parameter ordering', () => {
    const result = buildSynthesisContextRepairPrompt(
      'original prompt text',
      'invalid response text',
      'error message text'
    );

    const originalIdx = result.indexOf('original prompt text');
    const invalidIdx = result.indexOf('invalid response text');
    const errorIdx = result.indexOf('error message text');

    expect(originalIdx).toBeGreaterThan(-1);
    expect(invalidIdx).toBeGreaterThan(-1);
    expect(errorIdx).toBeGreaterThan(-1);
    expect(originalIdx).toBeLessThan(errorIdx);
    expect(errorIdx).toBeLessThan(invalidIdx);
  });
});
