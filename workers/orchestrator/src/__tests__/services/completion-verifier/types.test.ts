import { describe, it, expect } from 'vitest';
import type { CompletionVerifierVerdict } from '../../../services/completion-verifier/types.js';

describe('CompletionVerifierVerdict shape', () => {
  it('exposes telemetryMissingFields alongside missingFields', () => {
    const verdict: CompletionVerifierVerdict = {
      passed: false,
      missingFields: ['gh_pr_url'],
      telemetryMissingFields: ['memory_acknowledgment'],
      verifierFailure: false,
      trace: { transcript: '', prompt: '', response: '' },
    };
    expect(verdict.missingFields).toEqual(['gh_pr_url']);
    expect(verdict.telemetryMissingFields).toEqual(['memory_acknowledgment']);
  });
});
