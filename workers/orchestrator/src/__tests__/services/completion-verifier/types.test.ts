import { describe, it, expect } from 'vitest';
import type { CompletionVerifierVerdict } from '../../../services/completion-verifier/types.js';

describe('CompletionVerifierVerdict shape (post-INT-1470)', () => {
  it('accepts a kind=parsed verdict with data, missingRequired, telemetryMissing, warnings', () => {
    const verdict: CompletionVerifierVerdict = {
      kind: 'parsed',
      data: { outcome: 'implemented' },
      missingRequired: [],
      telemetryMissing: [],
      warnings: [],
    };
    expect(verdict.kind).toBe('parsed');
  });

  it('accepts a kind=hard-error verdict with code + message', () => {
    const verdict: CompletionVerifierVerdict = {
      kind: 'hard-error',
      code: 'TASK_RUNTIME_HARD_ERROR',
      message: 'No EXECUTION_AGENT_FINAL: block in transcript',
    };
    expect(verdict.kind).toBe('hard-error');
    if (verdict.kind === 'hard-error') {
      expect(verdict.code).toBe('TASK_RUNTIME_HARD_ERROR');
    }
  });
});
