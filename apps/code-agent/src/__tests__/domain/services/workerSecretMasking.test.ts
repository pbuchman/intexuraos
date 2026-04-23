/**
 * Unit tests for worker secret masking + credential validation helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  isMaskedCredential,
  maskSecret,
  maskWorkerConfig,
  MASK_CHAR,
  validateCredentialsNotMasked,
} from '../../../domain/services/workerSecretMasking.js';
import type { WorkerConfig } from '../../../domain/models/workerSettings.js';

describe('maskSecret', () => {
  it('returns three bullets for secrets of length ≤ 3', () => {
    expect(maskSecret('')).toBe('•••');
    expect(maskSecret('a')).toBe('•••');
    expect(maskSecret('abc')).toBe('•••');
  });

  it('keeps last 3 chars visible and caps bullet prefix at 20', () => {
    expect(maskSecret('abcd')).toBe('•bcd');
    expect(maskSecret('1234567890')).toBe('•••••••890');
    const veryLong = 'x'.repeat(50) + 'ABC';
    const masked = maskSecret(veryLong);
    expect(masked.endsWith('ABC')).toBe(true);
    // 20 bullets + last 3 chars
    expect(masked).toBe('•'.repeat(20) + 'ABC');
  });
});

describe('isMaskedCredential', () => {
  it('detects the bullet character', () => {
    expect(isMaskedCredential(`••${MASK_CHAR}345`)).toBe(true);
    expect(isMaskedCredential('plain-text')).toBe(false);
  });
});

describe('validateCredentialsNotMasked', () => {
  it('returns undefined when no credentials provided', () => {
    expect(validateCredentialsNotMasked({})).toBeUndefined();
  });

  it('returns undefined when every credential is non-masked', () => {
    expect(
      validateCredentialsNotMasked({
        cfAccessClientId: 'id',
        cfAccessClientSecret: 'secret',
        dispatchSigningSecret: 'signing',
      })
    ).toBeUndefined();
  });

  it('flags a masked cfAccessClientId', () => {
    const message = validateCredentialsNotMasked({ cfAccessClientId: '•••abc' });
    expect(message).toContain('CF Access Client ID');
    expect(message).toContain('masked');
  });

  it('flags a masked cfAccessClientSecret', () => {
    const message = validateCredentialsNotMasked({ cfAccessClientSecret: '•••abc' });
    expect(message).toContain('CF Access Client Secret');
  });

  it('flags a masked dispatchSigningSecret', () => {
    const message = validateCredentialsNotMasked({ dispatchSigningSecret: '•••abc' });
    expect(message).toContain('Orchestrator Secret');
  });
});

describe('maskWorkerConfig', () => {
  const baseConfig: WorkerConfig = {
    name: 'home-mac',
    url: 'https://mac.example.com',
    cfAccessClientId: 'client-id-12345',
    cfAccessClientSecret: 'secret-abcdef',
    dispatchSigningSecret: 'signing-xyz',
    enabled: true,
  };

  it('masks secrets and keeps non-secret fields intact', () => {
    const masked = maskWorkerConfig(baseConfig);
    expect(masked.name).toBe('home-mac');
    expect(masked.url).toBe('https://mac.example.com');
    expect(masked.enabled).toBe(true);
    expect(masked.cfAccessClientId.endsWith('345')).toBe(true);
    expect(masked.cfAccessClientId).toContain(MASK_CHAR);
    expect(masked.cfAccessClientSecret.endsWith('def')).toBe(true);
    expect(masked.dispatchSigningSecret.endsWith('xyz')).toBe(true);
  });

  it('omits optional test-result fields when absent', () => {
    const masked = maskWorkerConfig(baseConfig);
    expect(masked.lastTestedAt).toBeUndefined();
    expect(masked.testStatus).toBeUndefined();
    expect(masked.testMessage).toBeUndefined();
  });

  it('passes through optional test-result fields when present', () => {
    const masked = maskWorkerConfig({
      ...baseConfig,
      lastTestedAt: '2025-01-01T00:00:00.000Z',
      testStatus: 'success',
      testMessage: 'Connection successful',
    });
    expect(masked.lastTestedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(masked.testStatus).toBe('success');
    expect(masked.testMessage).toBe('Connection successful');
  });
});
