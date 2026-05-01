import { describe, expect, it } from 'vitest';
import { synthesisContextRepairPrompt } from '../repairPrompt.js';

describe('synthesisContextRepairPrompt', () => {
  it('has correct metadata', () => {
    expect(synthesisContextRepairPrompt.name).toBe('synthesis-context-repair');
    expect(synthesisContextRepairPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('includes original prompt in XML tags', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'test query',
      invalidResponse: '{}',
      errorMessage: 'some error',
    });

    expect(result).toContain('<user_query>');
    expect(result).toContain('test query');
    expect(result).toContain('</user_query>');
  });

  it('includes invalid response in XML tags', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'query',
      invalidResponse: '{bad json}',
      errorMessage: 'parse error',
    });

    expect(result).toContain('<invalid_response>');
    expect(result).toContain('{bad json}');
    expect(result).toContain('</invalid_response>');
  });

  it('includes error message', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'query',
      invalidResponse: '{}',
      errorMessage: 'missing field: domain',
    });

    expect(result).toContain('ERROR DETAILS:');
    expect(result).toContain('missing field: domain');
  });

  it('includes JSON schema requirements', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'query',
      invalidResponse: '{}',
      errorMessage: 'error',
    });

    expect(result).toContain('EXPECTED SCHEMA:');
    expect(result).toContain('"domain"');
    expect(result).toContain('"synthesis_goals"');
    expect(result).toContain('"detected_conflicts"');
  });

  it('includes JSON formatting rules', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'query',
      invalidResponse: '{}',
      errorMessage: 'error',
    });

    expect(result).toContain('Output ONLY valid JSON');
    expect(result).toContain('No trailing commas');
  });

  it('should include outdoor_recreation and fishing in domain list', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'query',
      invalidResponse: '{}',
      errorMessage: 'error',
    });
    expect(result).toContain('outdoor_recreation');
    expect(result).toContain('fishing');
    expect(result).toContain('construction_building');
  });

  it('should include user_exclusions in safety schema', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'query',
      invalidResponse: '{}',
      errorMessage: 'error',
    });
    expect(result).toContain('user_exclusions');
  });

  it('preserves parameter ordering', () => {
    const result = synthesisContextRepairPrompt.build({
      originalPrompt: 'original prompt text',
      invalidResponse: 'invalid response text',
      errorMessage: 'error message text',
    });

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
