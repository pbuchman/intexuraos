import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockVerify = vi.hoisted(() => vi.fn());
vi.mock('@intexuraos/internal-clients', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@intexuraos/internal-clients');
  return {
    ...actual,
    createGoogleOidcVerifier: vi.fn(() => mockVerify),
  };
});

import { authenticateInternalScheduler } from '../internalAuth.js';

function makeRequest(authHeader?: string, internalAuth?: string): never {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers['authorization'] = authHeader;
  if (internalAuth !== undefined) headers['x-internal-auth'] = internalAuth;
  return {
    headers,
    log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as never;
}

describe('authenticateInternalScheduler — Google OIDC verification', () => {
  const ORIG_URL = process.env['INTEXURAOS_SERVICE_URL'];
  const ORIG_TOKEN = process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

  beforeEach(() => {
    mockVerify.mockReset();
    process.env['INTEXURAOS_SERVICE_URL'] = 'https://code-agent.example';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'shared-secret';
  });

  afterEach(() => {
    if (ORIG_URL === undefined) delete process.env['INTEXURAOS_SERVICE_URL'];
    else process.env['INTEXURAOS_SERVICE_URL'] = ORIG_URL;
    if (ORIG_TOKEN === undefined) delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    else process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = ORIG_TOKEN;
  });

  it('accepts a verified Google OIDC bearer', async () => {
    mockVerify.mockResolvedValue({ valid: true, subject: 'sa@proj.iam.gserviceaccount.com' });
    const result = await authenticateInternalScheduler(makeRequest('Bearer good-token'));
    expect(result).toEqual({
      authenticated: true,
      strategy: 'scheduler-oidc',
      subject: 'sa@proj.iam.gserviceaccount.com',
    });
  });

  it('rejects when audience does not match', async () => {
    mockVerify.mockResolvedValue({ valid: false, reason: 'audience_mismatch' });
    const result = await authenticateInternalScheduler(makeRequest('Bearer wrong-aud'));
    expect(result).toEqual({ authenticated: false });
  });

  it('rejects when verification fails', async () => {
    mockVerify.mockResolvedValue({ valid: false, reason: 'verification_failed' });
    const result = await authenticateInternalScheduler(makeRequest('Bearer bad-sig'));
    expect(result).toEqual({ authenticated: false });
  });

  it('falls back to x-internal-auth when no Bearer header is present', async () => {
    const result = await authenticateInternalScheduler(makeRequest(undefined, 'shared-secret'));
    expect(result).toMatchObject({ authenticated: true, strategy: 'internal-token' });
  });

  it('rejects when neither Bearer nor x-internal-auth is provided', async () => {
    const result = await authenticateInternalScheduler(makeRequest());
    expect(result).toEqual({ authenticated: false });
  });

  it('rejects when x-internal-auth is wrong', async () => {
    const result = await authenticateInternalScheduler(makeRequest(undefined, 'wrong'));
    expect(result).toEqual({ authenticated: false });
  });
});
