/**
 * Tests for shared.ts - mapDomainErrorCode function.
 */
import { describe, expect, it } from 'vitest';
import { mapDomainErrorCode } from '../../routes/shared.js';
import type { PromptVaultErrorCode } from '../../domain/promptvault/index.js';

describe('mapDomainErrorCode', () => {
  it('maps NOT_FOUND to NOT_FOUND', () => {
    expect(mapDomainErrorCode('NOT_FOUND')).toBe('NOT_FOUND');
  });

  it('maps NOT_CONNECTED to MISCONFIGURED', () => {
    expect(mapDomainErrorCode('NOT_CONNECTED')).toBe('MISCONFIGURED');
  });

  it('maps VALIDATION_ERROR to INVALID_REQUEST', () => {
    expect(mapDomainErrorCode('VALIDATION_ERROR')).toBe('INVALID_REQUEST');
  });

  it('maps UNAUTHORIZED to UNAUTHORIZED', () => {
    expect(mapDomainErrorCode('UNAUTHORIZED')).toBe('UNAUTHORIZED');
  });

  it('maps RATE_LIMITED to DOWNSTREAM_ERROR', () => {
    // Cast since RATE_LIMITED is not a current PromptVaultErrorCode but may be returned by downstream
    expect(mapDomainErrorCode('RATE_LIMITED' as PromptVaultErrorCode)).toBe('DOWNSTREAM_ERROR');
  });

  it('maps INTERNAL_ERROR to DOWNSTREAM_ERROR', () => {
    expect(mapDomainErrorCode('INTERNAL_ERROR')).toBe('DOWNSTREAM_ERROR');
  });

  it('maps unknown error codes to DOWNSTREAM_ERROR', () => {
    // Cast to test the default case
    const unknownCode = 'UNKNOWN_CODE' as PromptVaultErrorCode;
    expect(mapDomainErrorCode(unknownCode)).toBe('DOWNSTREAM_ERROR');
  });
});
