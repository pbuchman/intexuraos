import { describe, it, expect, vi, afterEach } from 'vitest';

const verify = vi.hoisted(() => vi.fn());
// Provide the real `errors` namespace from jose by partially-mocking only the
// surface we control (createRemoteJWKSet + jwtVerify). `errors` retains the
// real `JWTClaimValidationFailed` constructor used by the SUT.
vi.mock('jose', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('jose');
  return {
    ...actual,
    createRemoteJWKSet: (): object => ({}),
    jwtVerify: verify,
  };
});

import { errors as joseErrors } from 'jose';
import { createGoogleOidcVerifier } from '../oidcVerifier.js';

function makeClaimError(claim: string): Error {
  // jose v6 signature: new JWTClaimValidationFailed(message, payload, claim, reason)
  return new joseErrors.JWTClaimValidationFailed(
    `unexpected ${claim} claim value`,
    {},
    claim,
    'check_failed'
  );
}

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

  it('passes audience and issuer list to jose.jwtVerify', async () => {
    verify.mockResolvedValue({
      payload: { aud: 'https://svc', iss: 'https://accounts.google.com', sub: 'x' },
    });
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    await v('Bearer t');
    expect(verify).toHaveBeenCalledWith(
      't',
      expect.anything(),
      expect.objectContaining({
        audience: 'https://svc',
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
      })
    );
  });

  it('maps jose claim error (aud) → audience_mismatch', async () => {
    verify.mockRejectedValue(makeClaimError('aud'));
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: false,
      reason: 'audience_mismatch',
    });
  });

  it('maps jose claim error (iss) → issuer_mismatch', async () => {
    verify.mockRejectedValue(makeClaimError('iss'));
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: false,
      reason: 'issuer_mismatch',
    });
  });

  it('maps jose claim error with unrelated claim → verification_failed', async () => {
    verify.mockRejectedValue(makeClaimError('exp'));
    const v = createGoogleOidcVerifier({ audience: 'https://svc' });
    expect(await v('Bearer t')).toEqual({
      valid: false,
      reason: 'verification_failed',
    });
  });

  it('accepts verified Google token, uses email as subject', async () => {
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

  it('falls back to sub when email is missing', async () => {
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

  it('rejects when jose throws non-claim error', async () => {
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
