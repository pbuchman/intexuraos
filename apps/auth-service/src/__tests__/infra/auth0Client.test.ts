/**
 * Tests for Auth0 client implementation.
 * Mocks fetch() to simulate Auth0 API responses.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import nock from 'nock';
import { Auth0ClientImpl, loadAuth0Config } from '../../infra/auth0/client.js';

const AUTH0_DOMAIN = 'test-tenant.auth0.com';
const CLIENT_ID = 'test-client-id';
const REFRESH_TOKEN = 'test-refresh-token';

describe('Auth0ClientImpl', () => {
  let client: Auth0ClientImpl;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    client = new Auth0ClientImpl({ domain: AUTH0_DOMAIN, clientId: CLIENT_ID });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('refreshAccessToken', () => {
    it('returns tokens on successful refresh', async () => {
      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(200, {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 86400,
        scope: 'openid profile email',
        id_token: 'new-id-token',
        refresh_token: 'rotated-refresh-token',
      });

      const result = await client.refreshAccessToken(REFRESH_TOKEN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('new-access-token');
        expect(result.value.tokenType).toBe('Bearer');
        expect(result.value.expiresIn).toBe(86400);
        expect(result.value.scope).toBe('openid profile email');
        expect(result.value.idToken).toBe('new-id-token');
        expect(result.value.refreshToken).toBe('rotated-refresh-token');
      }
    });

    it('returns INVALID_GRANT error when refresh token is invalid', async () => {
      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(403, {
        error: 'invalid_grant',
        error_description: 'Unknown or invalid refresh token.',
      });

      const result = await client.refreshAccessToken('bad-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_GRANT');
        expect(result.error.message).toContain('invalid');
      }
    });

    it('returns INTERNAL_ERROR for other Auth0 errors', async () => {
      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(400, {
        error: 'invalid_request',
        error_description: 'Missing required parameter',
      });

      const result = await client.refreshAccessToken(REFRESH_TOKEN);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Missing required parameter');
      }
    });

    it('returns INTERNAL_ERROR for non-JSON error response', async () => {
      nock(`https://${AUTH0_DOMAIN}`)
        .post('/oauth/token')
        .reply(500, 'Internal Server Error', { 'content-type': 'text/plain' });

      const result = await client.refreshAccessToken(REFRESH_TOKEN);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('returns INTERNAL_ERROR on network failure', async () => {
      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').replyWithError('Connection refused');

      const result = await client.refreshAccessToken(REFRESH_TOKEN);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('Auth0 request failed');
      }
    });

    it('handles response without optional fields', async () => {
      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(200, {
        access_token: 'access-only',
        token_type: 'Bearer',
        expires_in: 3600,
      });

      const result = await client.refreshAccessToken(REFRESH_TOKEN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('access-only');
        expect(result.value.scope).toBeUndefined();
        expect(result.value.idToken).toBeUndefined();
        expect(result.value.refreshToken).toBeUndefined();
      }
    });
  });
});

describe('loadAuth0Config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns config when both env vars are set', () => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['AUTH0_CLIENT_ID'] = 'client-123';

    const config = loadAuth0Config();

    expect(config).not.toBeNull();
    expect(config?.domain).toBe('test.auth0.com');
    expect(config?.clientId).toBe('client-123');
  });

  it('returns null when domain is missing', () => {
    delete process.env['AUTH0_DOMAIN'];
    process.env['AUTH0_CLIENT_ID'] = 'client-123';

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });

  it('returns null when client ID is missing', () => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    delete process.env['AUTH0_CLIENT_ID'];

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });

  it('returns null when domain is empty string', () => {
    process.env['AUTH0_DOMAIN'] = '';
    process.env['AUTH0_CLIENT_ID'] = 'client-123';

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });

  it('returns null when client ID is empty string', () => {
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['AUTH0_CLIENT_ID'] = '';

    const config = loadAuth0Config();

    expect(config).toBeNull();
  });
});
