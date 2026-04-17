import { describe, expect, it } from 'vitest';
import {
  type DigestError,
  llmCallFailed,
  repairExhausted,
  zodValidationFailed,
  inputInvalid,
  lockHeld,
  persistenceFailed,
} from '../../../domain/usecases/digestErrors.js';

describe('DigestError factories', () => {
  it('creates llm-call-failed', () => {
    const e: DigestError = llmCallFailed('upstream timeout');
    expect(e.code).toBe('llm-call-failed');
    if (e.code !== 'llm-call-failed') return;
    expect(e.message).toBe('upstream timeout');
  });

  it('creates repair-exhausted with attempt count', () => {
    const e: DigestError = repairExhausted(3, 'final invalid JSON');
    expect(e.code).toBe('repair-exhausted');
    if (e.code !== 'repair-exhausted') return;
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

  it('creates lock-held with heldBy', () => {
    const e: DigestError = lockHeld('cron');
    expect(e.code).toBe('lock-held');
    if (e.code !== 'lock-held') return;
    expect(e.heldBy).toBe('cron');
  });

  it('creates persistence-failed with message', () => {
    const e: DigestError = persistenceFailed('Firestore write failed');
    expect(e.code).toBe('persistence-failed');
    if (e.code !== 'persistence-failed') return;
    expect(e.message).toBe('Firestore write failed');
  });
});
