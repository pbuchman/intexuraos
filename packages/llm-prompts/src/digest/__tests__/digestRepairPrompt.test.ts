import { describe, expect, it } from 'vitest';
import { digestRepairPrompt, DIGEST_REPAIR_PROMPT_VERSION } from '../digestRepairPrompt.js';

describe('digestRepairPrompt', () => {
  it('has correct metadata', () => {
    expect(digestRepairPrompt.name).toBe('whatsapp-digest-repair');
    expect(digestRepairPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(digestRepairPrompt.version).toBe(DIGEST_REPAIR_PROMPT_VERSION);
  });

  it('embeds the original prompt, the invalid response, and the error message', () => {
    const repair = digestRepairPrompt.build({
      originalPrompt: 'ORIGINAL_PROMPT_BODY',
      invalidResponse: '{"dailySummary": "broken"}',
      errorMessage: 'Expected object, got string at dailySummary',
      outputLanguage: 'Polish',
    });
    expect(repair).toContain('ORIGINAL_PROMPT_BODY');
    expect(repair).toContain('{"dailySummary": "broken"}');
    expect(repair).toContain('Expected object, got string at dailySummary');
  });

  it('exposes a semver version constant', () => {
    expect(DIGEST_REPAIR_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('instructs the model to return ONLY JSON, no markdown', () => {
    const repair = digestRepairPrompt.build({
      originalPrompt: 'A',
      invalidResponse: 'B',
      errorMessage: 'C',
      outputLanguage: 'Polish',
    });
    expect(repair.toLowerCase()).toContain('only');
    expect(repair.toLowerCase()).toContain('json');
  });

  it('requires repaired text to use the target language', () => {
    const repair = digestRepairPrompt.build({
      originalPrompt: 'ORIGINAL_PROMPT_BODY',
      invalidResponse: '{"dailySummary": {"headline": "English headline"}}',
      errorMessage: 'missing fields',
      outputLanguage: 'Polish',
    });

    expect(repair).toContain('Target output language: Polish');
    expect(repair).toContain('translate it to the target output language');
  });
});
