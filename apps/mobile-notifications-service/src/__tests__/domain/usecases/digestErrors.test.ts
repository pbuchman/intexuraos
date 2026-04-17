import { describe, expect, it } from 'vitest';
import {
  type DigestError,
  llmCallFailed,
  repairExhausted,
  zodValidationFailed,
  inputInvalid,
} from '../../../domain/usecases/digestErrors.js';

describe('DigestError factories', () => {
  it('creates llm-call-failed', () => {
    const e: DigestError = llmCallFailed('upstream timeout');
    expect(e.code).toBe('llm-call-failed');
    expect(e.message).toBe('upstream timeout');
  });

  it('creates repair-exhausted with attempt count', () => {
    const e: DigestError = repairExhausted(3, 'final invalid JSON');
    expect(e.code).toBe('repair-exhausted');
    expect(e.attempts).toBe(3);
  });

  it('creates zod-validation-failed with details', () => {
    const e = zodValidationFailed('Expected object');
    expect(e.code).toBe('zod-validation-failed');
  });

  it('creates input-invalid', () => {
    const e = inputInvalid('date must be YYYY-MM-DD');
    expect(e.code).toBe('input-invalid');
  });
});
