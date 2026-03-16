/**
 * Tests for GitHub OAuth connection routes:
 * - POST /oauth/connections/github/initiate
 * - GET /oauth/connections/github/callback
 * - GET /oauth/connections/github/status
 * - DELETE /oauth/connections/github
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeAuthTokenRepository,
  FakeOAuthConnectionRepository,
  FakeGitHubOAuthClient,
  FakeUserSettingsRepository,
} from './fakes.js';
import { OAuthProviders } from '../domain/oauth/index.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';
const INTEXURAOS_WEB_APP_URL = 'http://localhost:5173';

describe('GitHub OAuth Connection Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  let privateKey: jose.KeyLike;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  let fakeAuthTokenRepo: FakeAuthTokenRepository;
  let fakeSettingsRepo: FakeUserSettingsRepository;
  let fakeOAuthRepo: FakeOAuthConnectionRepository;
  let fakeGitHubOAuthClient: FakeGitHubOAuthClient;

  async function createJwt(userId: string): Promise<string> {
    const jwt = await new jose.SignJWT({ sub: userId })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(issuer)
      .setAudience(INTEXURAOS_AUTH_AUDIENCE)
      .setExpirationTime('1h')
      .sign(privateKey);
    return jwt;
  }

  beforeAll(async () => {
    const keyPair = await jose.generateKeyPair('RS256');
    privateKey = keyPair.privateKey;

    const publicKeyJwk = await jose.exportJWK(keyPair.publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    jwksServer = Fastify({ logger: false });
    jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
      return await reply.send({ keys: [publicKeyJwk] });
    });

    await jwksServer.listen({ port: 0, host: '127.0.0.1' });
    const address = jwksServer.server.address();
    if (address !== null && typeof address === 'object') {
      jwksUrl = `http://127.0.0.1:${String(address.port)}/.well-known/jwks.json`;
    }
  });

  afterAll(async () => {
    await jwksServer.close();
  });

  beforeEach(() => {
    process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
    process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
    process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;
    process.env['INTEXURAOS_WEB_APP_URL'] = INTEXURAOS_WEB_APP_URL;

    clearJwksCache();

    fakeAuthTokenRepo = new FakeAuthTokenRepository();
    fakeSettingsRepo = new FakeUserSettingsRepository();
    fakeOAuthRepo = new FakeOAuthConnectionRepository();
    fakeGitHubOAuthClient = new FakeGitHubOAuthClient();

    setServices({
      authTokenRepository: fakeAuthTokenRepo,
      userSettingsRepository: fakeSettingsRepo,
      oauthConnectionRepository: fakeOAuthRepo,
      auth0Client: null,
      googleOAuthClient: null,
      gitHubOAuthClient: fakeGitHubOAuthClient,
      encryptor: null,
      llmValidator: null,
    });
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_WEB_APP_URL'];
  });

  describe('POST /oauth/connections/github/initiate', () => {
    it('returns 401 when not authenticated', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/github/initiate',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns authorization URL when authenticated', { timeout: 20000 }, async () => {
      app = await buildServer();
      const token = await createJwt('auth0|user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/github/initiate',
        headers: {
          authorization: `Bearer ${token}`,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'api.example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { authorizationUrl: string } };
      expect(body.success).toBe(true);
      expect(body.data.authorizationUrl).toContain('https://github.com/login/oauth/authorize');
    });

    it('uses default protocol and host when forwarded headers are missing', { timeout: 20000 }, async () => {
      app = await buildServer();
      const token = await createJwt('auth0|user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/github/initiate',
        headers: {
          authorization: `Bearer ${token}`,
          host: 'api.example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { authorizationUrl: string } };
      expect(body.success).toBe(true);
      expect(body.data.authorizationUrl).toContain('https://github.com/login/oauth/authorize');
    });

    it('uses fallback localhost when both forwarded headers and host header are missing', { timeout: 20000 }, async () => {
      app = await buildServer();
      const token = await createJwt('auth0|user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/github/initiate',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { authorizationUrl: string } };
      expect(body.success).toBe(true);
      expect(body.data.authorizationUrl).toContain('https://github.com/login/oauth/authorize');
    });

    it('returns 503 when GitHub OAuth is not configured', { timeout: 20000 }, async () => {
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        oauthConnectionRepository: fakeOAuthRepo,
        auth0Client: null,
        googleOAuthClient: null,
        gitHubOAuthClient: null,
        encryptor: null,
        llmValidator: null,
      });

      app = await buildServer();
      const token = await createJwt('auth0|user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/github/initiate',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });
  });

  describe('GET /oauth/connections/github/callback', () => {
    function createValidState(userId: string): string {
      const statePayload = {
        userId,
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://api.example.com/oauth/connections/github/callback',
        createdAt: Date.now(),
        nonce: 'test-nonce',
      };
      return Buffer.from(JSON.stringify(statePayload)).toString('base64url');
    }

    it('uses localhost:5173 fallback when INTEXURAOS_WEB_APP_URL is not set', async () => {
      delete process.env['INTEXURAOS_WEB_APP_URL'];
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('http://localhost:5173');
      expect(response.headers.location).toContain('/#/settings/github');
    });

    it('redirects with error when error parameter is present', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=access_denied');
      expect(response.headers.location).toContain('/#/settings/github');
    });

    it('redirects with error when code is missing', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/callback?state=some-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('Missing%20code%20or%20state%20parameter');
    });

    it('redirects with error when state is missing', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/callback?code=some-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });

    it('redirects with error when GitHub OAuth is not configured', async () => {
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        oauthConnectionRepository: fakeOAuthRepo,
        auth0Client: null,
        googleOAuthClient: null,
        gitHubOAuthClient: null,
        encryptor: null,
        llmValidator: null,
      });

      app = await buildServer();
      const state = createValidState('auth0|user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/github/callback?code=some-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('GitHub%20OAuth%20is%20not%20configured');
    });

    it('redirects with success when code exchange succeeds', async () => {
      app = await buildServer();
      const userId = 'auth0|user-123';
      const state = createValidState(userId);

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/github/callback?code=valid-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_success=true');
      expect(response.headers.location).toContain('/#/settings/github');

      // Verify the connection was stored with username in email field
      const stored = fakeOAuthRepo.getStoredConnection(userId, OAuthProviders.GITHUB);
      expect(stored).toBeDefined();
      expect(stored?.email).toBe('test-github-user');
      expect(stored?.tokens.refreshToken).toBe('');
      expect(stored?.tokens.expiresAt).toBe('9999-12-31T00:00:00.000Z');
    });

    it('redirects with error when state is invalid', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/callback?code=some-code&state=invalid-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('Invalid%20OAuth%20state%20parameter');
    });

    it('redirects with error when state is expired', async () => {
      app = await buildServer();
      const expiredStatePayload = {
        userId: 'auth0|user-123',
        provider: OAuthProviders.GITHUB,
        redirectUri: 'https://api.example.com/oauth/connections/github/callback',
        createdAt: Date.now() - 15 * 60 * 1000, // 15 minutes ago
        nonce: 'test-nonce',
      };
      const expiredState = Buffer.from(JSON.stringify(expiredStatePayload)).toString('base64url');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/github/callback?code=some-code&state=${expiredState}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('expired');
    });

    it('redirects with error when token exchange fails', async () => {
      fakeGitHubOAuthClient.setFailNextExchange(true);
      app = await buildServer();
      const state = createValidState('auth0|user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/github/callback?code=some-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });

    it('redirects with error when user info fetch fails', async () => {
      fakeGitHubOAuthClient.setFailNextUserInfo(true);
      app = await buildServer();
      const state = createValidState('auth0|user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/github/callback?code=some-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });

    it('redirects with error when save fails', async () => {
      fakeOAuthRepo.setFailNextSave(true);
      app = await buildServer();
      const state = createValidState('auth0|user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/github/callback?code=some-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });
  });

  describe('GET /oauth/connections/github/status', () => {
    it('returns 401 when not authenticated', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/status',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns not connected when no connection exists', { timeout: 20000 }, async () => {
      app = await buildServer();
      const token = await createJwt('auth0|user-no-github');

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { connected: boolean; username: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(false);
      expect(body.data.username).toBeNull();
    });

    it('returns connected when connection exists', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-with-github';
      fakeOAuthRepo.setConnection(userId, OAuthProviders.GITHUB, {
        userId,
        provider: OAuthProviders.GITHUB,
        email: 'octocat',
        tokens: {
          accessToken: 'fake-access-token',
          refreshToken: '',
          expiresAt: '9999-12-31T00:00:00.000Z',
          scope: 'repo read:user',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();
      const token = await createJwt(userId);

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { connected: boolean; username: string; scopes: string[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.username).toBe('octocat');
    });

    it('returns 500 when repository fails', { timeout: 20000 }, async () => {
      fakeOAuthRepo.setFailNextGetPublic(true);
      app = await buildServer();
      const token = await createJwt('auth0|user-error');

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/github/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /oauth/connections/github', () => {
    it('returns 401 when not authenticated', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/github',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 503 when GitHub OAuth is not configured', { timeout: 20000 }, async () => {
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        oauthConnectionRepository: fakeOAuthRepo,
        auth0Client: null,
        googleOAuthClient: null,
        gitHubOAuthClient: null,
        encryptor: null,
        llmValidator: null,
      });

      app = await buildServer();
      const token = await createJwt('auth0|user-123');

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/github',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('disconnects successfully when connection exists', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-to-disconnect';
      fakeOAuthRepo.setConnection(userId, OAuthProviders.GITHUB, {
        userId,
        provider: OAuthProviders.GITHUB,
        email: 'octocat',
        tokens: {
          accessToken: 'fake-access-token',
          refreshToken: '',
          expiresAt: '9999-12-31T00:00:00.000Z',
          scope: 'repo read:user',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();
      const token = await createJwt(userId);

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/github',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify the connection was removed
      const stored = fakeOAuthRepo.getStoredConnection(userId, OAuthProviders.GITHUB);
      expect(stored).toBeUndefined();
    });

    it('disconnects successfully when no connection exists (revoke skipped)', { timeout: 20000 }, async () => {
      app = await buildServer();
      const token = await createJwt('auth0|user-no-connection');

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/github',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('still disconnects when token revoke fails (best-effort)', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-revoke-fail';
      fakeOAuthRepo.setConnection(userId, OAuthProviders.GITHUB, {
        userId,
        provider: OAuthProviders.GITHUB,
        email: 'octocat',
        tokens: {
          accessToken: 'fake-access-token',
          refreshToken: '',
          expiresAt: '9999-12-31T00:00:00.000Z',
          scope: 'repo read:user',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeGitHubOAuthClient.setFailNextRevoke(true);

      app = await buildServer();
      const token = await createJwt(userId);

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/github',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 500 when get connection fails', { timeout: 20000 }, async () => {
      fakeOAuthRepo.setFailNextGet(true);
      app = await buildServer();
      const token = await createJwt('auth0|user-error');

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/github',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when delete connection fails', { timeout: 20000 }, async () => {
      fakeOAuthRepo.setFailNextDelete(true);
      app = await buildServer();
      const token = await createJwt('auth0|user-delete-fail');

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/github',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
