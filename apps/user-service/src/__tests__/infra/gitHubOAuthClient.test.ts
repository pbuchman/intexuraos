/**
 * Tests for GitHub OAuth client.
 * Uses nock to mock HTTP requests to GitHub APIs.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { GitHubOAuthClientImpl } from '../../infra/github/gitHubOAuthClient.js';

const TEST_CONFIG = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
};

describe('GitHubOAuthClientImpl', () => {
  let client: GitHubOAuthClientImpl;

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    client = new GitHubOAuthClientImpl(TEST_CONFIG);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('generateAuthUrl', () => {
    it('generates correct authorization URL', () => {
      const url = client.generateAuthUrl('test-state', 'https://example.com/callback');

      expect(url).toContain('https://github.com/login/oauth/authorize');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('redirect_uri=https%3A%2F%2Fexample.com%2Fcallback');
      expect(url).toContain('state=test-state');
      expect(url).toContain('response_type=code');
      expect(url).toContain('scope=');
    });

    it('includes repo and read:user scopes', () => {
      const url = client.generateAuthUrl('state', 'https://example.com/callback');

      expect(url).toContain('repo');
      expect(url).toContain('read%3Auser');
    });
  });

  describe('exchangeCode', () => {
    it('exchanges authorization code for tokens', async () => {
      nock('https://github.com')
        .post('/login/oauth/access_token')
        .matchHeader('accept', 'application/json')
        .reply(200, {
          access_token: 'test-access-token',
          token_type: 'bearer',
          scope: 'repo,read:user',
        });

      const result = await client.exchangeCode('auth-code', 'https://example.com/callback');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('test-access-token');
        expect(result.value.tokenType).toBe('bearer');
        expect(result.value.scope).toBe('repo,read:user');
      }
    });

    it('returns error when exchange fails with HTTP error', async () => {
      nock('https://github.com')
        .post('/login/oauth/access_token')
        .reply(400, { error: 'bad_verification_code', error_description: 'Code expired' });

      const result = await client.exchangeCode('invalid-code', 'https://example.com/callback');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_EXCHANGE_FAILED');
        expect(result.error.message).toContain('400');
      }
    });

    it('handles network errors', async () => {
      nock('https://github.com')
        .post('/login/oauth/access_token')
        .replyWithError('Network error');

      const result = await client.exchangeCode('auth-code', 'https://example.com/callback');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TOKEN_EXCHANGE_FAILED');
        expect(result.error.message).toContain('error');
      }
    });
  });

  describe('getUserInfo', () => {
    it('retrieves user info successfully with email', async () => {
      nock('https://api.github.com')
        .get('/user')
        .matchHeader('authorization', 'Bearer test-token')
        .reply(200, {
          login: 'testuser',
          email: 'user@example.com',
        });

      const result = await client.getUserInfo('test-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.username).toBe('testuser');
        expect(result.value.email).toBe('user@example.com');
      }
    });

    it('retrieves user info when email is null', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, {
          login: 'testuser',
          email: null,
        });

      const result = await client.getUserInfo('test-token');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.username).toBe('testuser');
        expect(result.value.email).toBeNull();
      }
    });

    it('returns error when request fails', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(401, { message: 'Bad credentials' });

      const result = await client.getUserInfo('invalid-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message).toContain('401');
      }
    });

    it('handles network errors', async () => {
      nock('https://api.github.com')
        .get('/user')
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
      nock('https://api.github.com')
        .delete(`/applications/${TEST_CONFIG.clientId}/grant`)
        .basicAuth({ user: TEST_CONFIG.clientId, pass: TEST_CONFIG.clientSecret })
        .reply(204);

      const result = await client.revokeToken('test-token');

      expect(result.ok).toBe(true);
    });

    it('returns error on failure', async () => {
      nock('https://api.github.com')
        .delete(`/applications/${TEST_CONFIG.clientId}/grant`)
        .reply(500, 'Internal error');

      const result = await client.revokeToken('test-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });

    it('handles network errors', async () => {
      nock('https://api.github.com')
        .delete(`/applications/${TEST_CONFIG.clientId}/grant`)
        .replyWithError('Network error');

      const result = await client.revokeToken('test-token');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });
});
