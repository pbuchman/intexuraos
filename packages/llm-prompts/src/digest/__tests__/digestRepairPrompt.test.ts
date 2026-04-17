import { describe, expect, it } from 'vitest';
import { buildDigestRepairPrompt, DIGEST_REPAIR_PROMPT_VERSION } from '../digestRepairPrompt.js';

describe('buildDigestRepairPrompt', () => {
  it('embeds the original prompt, the invalid response, and the error message', () => {
    const repair = buildDigestRepairPrompt(
      'ORIGINAL_PROMPT_BODY',
      '{"dailySummary": "broken"}',
      'Expected object, got string at dailySummary'
    );
    expect(repair).toContain('ORIGINAL_PROMPT_BODY');
    expect(repair).toContain('{"dailySummary": "broken"}');
    expect(repair).toContain('Expected object, got string at dailySummary');
  });

  it('exposes a semver version constant', () => {
    expect(DIGEST_REPAIR_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('instructs the model to return ONLY JSON, no markdown', () => {
    const repair = buildDigestRepairPrompt('A', 'B', 'C');
    expect(repair.toLowerCase()).toContain('tylko');
    expect(repair.toLowerCase()).toContain('json');
  });
});
