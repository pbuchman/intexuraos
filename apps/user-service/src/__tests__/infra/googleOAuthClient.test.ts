/**
 * Tests for Google OAuth client.
 * Uses nock to mock HTTP requests to Google APIs.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { GoogleOAuthClientImpl } from '../../infra/google/googleOAuthClient.js';

const TEST_CONFIG = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

describe('GoogleOAuthClientImpl', () => {
  let client: GoogleOAuthClientImpl;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    client = new GoogleOAuthClientImpl(TEST_CONFIG);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('generateAuthUrl', () => {
    it('generates correct authorization URL', () => {
      const url = client.generateAuthUrl('test-state', 'https://example.com/callback');

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(url).toContain('state=test-state');
      expect(url).toContain('response_type=code');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('scope=');
    });

    it('includes calendar and userinfo scopes', () => {
      const url = client.generateAuthUrl('state', 'https://example.com/callback');

      expect(url).toContain('calendar.events');
      expect(url).toContain('userinfo.email');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges authorization code for tokens', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(200, {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_in: 3600,
          scope: 'email calendar.events',
          token_type: 'Bearer',
        });

      const result = await client.exchangeCode('auth-code', 'https://example.com/callback');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('test-access-token');
        expect(result.value.refreshToken).toBe('test-refresh-token');
        expect(result.value.expiresIn).toBe(3600);
        expect(result.value.scope).toBe('email calendar.events');
        expect(result.value.tokenType).toBe('Bearer');
      }
    });

    it('returns error when exchange fails with HTTP error', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(400, { error: 'invalid_grant', error_description: 'Code expired' });

      const result = await client.exchangeCode('invalid-code', 'https://example.com/callback');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_EXCHANGE_FAILED');
        expect(result.error.message).toContain('400');
      }
    });

    it('returns error when no refresh token is returned', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(200, {
          access_token: 'test-access-token',
          expires_in: 3600,
          scope: 'email',
          token_type: 'Bearer',
        });

      const result = await client.exchangeCode('auth-code', 'https://example.com/callback');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_EXCHANGE_FAILED');
        expect(result.error.message).toContain('No refresh token');
      }
    });

    it('handles network errors', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .replyWithError('Network error');

      const result = await client.exchangeCode('auth-code', 'https://example.com/callback');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_EXCHANGE_FAILED');
        expect(result.error.message).toContain('error');
      }
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes access token successfully', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(200, {
          access_token: 'new-access-token',
          expires_in: 3600,
          scope: 'email calendar.events',
          token_type: 'Bearer',
        });

      const result = await client.refreshAccessToken('refresh-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('new-access-token');
        expect(result.value.refreshToken).toBe('refresh-token');
      }
    });

    it('uses new refresh token if provided', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(200, {
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          expires_in: 3600,
          scope: 'email calendar.events',
          token_type: 'Bearer',
        });

      const result = await client.refreshAccessToken('old-refresh-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.refreshToken).toBe('new-refresh-token');
      }
    });

    it('returns error when refresh fails', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(401, { error: 'invalid_token' });

      const result = await client.refreshAccessToken('invalid-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_REFRESH_FAILED');
      }
    });

    it('handles network errors', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .replyWithError('Connection refused');

      const result = await client.refreshAccessToken('refresh-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_REFRESH_FAILED');
      }
    });
  });

  describe('getUserInfo', () => {
    it('retrieves user info successfully', async () => {
      nock('https://www.googleapis.com')
        .get('/oauth2/v2/userinfo')
        .matchHeader('authorization', 'Bearer test-token')
        .reply(200, {
          email: 'user@example.com',
          verified_email: true,
        });

      const result = await client.getUserInfo('test-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.email).toBe('user@example.com');
        expect(result.value.verified).toBe(true);
      }
    });

    it('returns error when request fails', async () => {
      nock('https://www.googleapis.com')
        .get('/oauth2/v2/userinfo')
        .reply(401, { error: 'invalid_token' });

      const result = await client.getUserInfo('invalid-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('401');
      }
    });

    it('handles network errors', async () => {
      nock('https://www.googleapis.com')
        .get('/oauth2/v2/userinfo')
        .replyWithError('Network error');

      const result = await client.getUserInfo('test-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('revokeToken', () => {
    it('revokes token successfully', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/revoke')
        .query({ token: 'test-token' })
        .reply(200);

      const result = await client.revokeToken('test-token');

      expect(result.ok).toBe(true);
    });

    it('treats 400 as success (token already revoked)', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/revoke')
        .query({ token: 'invalid-token' })
        .reply(400, { error: 'invalid_token' });

      const result = await client.revokeToken('invalid-token');

      expect(result.ok).toBe(true);
    });

    it('returns error on other failures', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/revoke')
        .query({ token: 'test-token' })
        .reply(500, 'Internal error');

      const result = await client.revokeToken('test-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('handles network errors', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/revoke')
        .query({ token: 'test-token' })
        .replyWithError('Network error');

      const result = await client.revokeToken('test-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
