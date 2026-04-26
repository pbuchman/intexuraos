import { describe, it, expect, vi, afterEach } from 'vitest';

const verify = vi.hoisted(() => vi.fn());
vi.mock('jose', () => ({
  createRemoteJWKSet: (): object => ({}),
  jwtVerify: verify,
}));

import { createGoogleOidcVerifier } from '../oidcVerifier.js';

describe('createGoogleOidcVerifier', () => {
  // Reset AFTER each test, not before. Vitest 4 (4.0.17) treats a hoisted
  // `vi.fn()` mock followed by `beforeEach(() => mock.mockReset())` as a
  // tracked-rejection trap: subsequent `mockRejectedValue` calls register
  // the rejection with Vitest's unhandled-rejection listener even when the
  // SUT's try/catch consumes it. Resetting in `afterEach` (or omitting reset)
  // sidesteps the bug while still isolating mocks between tests.
  afterEach(() => verify.mockReset());

  it('rejects missing Authorization header', async () => {
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v(undefined)).toEqual({
      valid: false,
      reason: 'missing_bearer',
    });
  });

  it('rejects header without Bearer prefix', async () => {
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Basic abc')).toEqual({
      valid: false,
      reason: 'missing_bearer',
    });
  });

  it('rejects audience mismatch', async () => {
    verify.mockResolvedValue({
      payload: { aud: 'https://other', iss: 'https://accounts.google.com' },
    });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: false,
      reason: 'audience_mismatch',
    });
  });

  it('rejects non-Google issuer', async () => {
    verify.mockResolvedValue({
      payload: { aud: 'https://svc', iss: 'https://evil.example' },
    });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: false,
      reason: 'issuer_mismatch',
    });
  });

  it('rejects when issuer missing', async () => {
    verify.mockResolvedValue({ payload: { aud: 'https://svc' } });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: false,
      reason: 'issuer_mismatch',
    });
  });

  it('accepts verified Google token (https://accounts.google.com), uses email as subject', async () => {
    verify.mockResolvedValue({
      payload: {
        aud: 'https://svc',
        iss: 'https://accounts.google.com',
        email: 'sa@proj.iam.gserviceaccount.com',
      },
    });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: true,
      subject: 'sa@proj.iam.gserviceaccount.com',
    });
  });

  it('accepts verified Google token (accounts.google.com bare), falls back to sub when email missing', async () => {
    verify.mockResolvedValue({
      payload: {
        aud: 'https://svc',
        iss: 'accounts.google.com',
        sub: '12345',
      },
    });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({ valid: true, subject: '12345' });
  });

  it('falls back to empty subject if neither email nor sub present', async () => {
    verify.mockResolvedValue({
      payload: { aud: 'https://svc', iss: 'https://accounts.google.com' },
    });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({ valid: true, subject: '' });
  });

  it('rejects when jose throws', async () => {
    verify.mockRejectedValue(new Error('bad sig'));
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: false,
      reason: 'verification_failed',
    });
  });

  it('uses provided jwksUrl override', async () => {
    verify.mockResolvedValue({
      payload: { aud: 'https://svc', iss: 'https://accounts.google.com' },
    });
    const v = createGoogleOidcVerifier({
      audience: 'https://svc',
      jwksUrl: 'https://example.test/jwks',
    });
    expect(await v('Bearer t')).toMatchObject({ valid: true });
  });
});
