/**
 * Tests for OAuth connection routes:
 * - POST /oauth/connections/google/initiate
 * - GET /oauth/connections/google/callback
 * - GET /oauth/connections/google/status
 * - DELETE /oauth/connections/google
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
  FakeGoogleOAuthClient,
  FakeUserSettingsRepository,
} from './fakes.js';
import { OAuthProviders } from '../domain/oauth/index.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';
const INTEXURAOS_WEB_APP_URL = 'http://localhost:5173';

describe('OAuth Connection Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  let privateKey: jose.KeyLike;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  let fakeAuthTokenRepo: FakeAuthTokenRepository;
  let fakeSettingsRepo: FakeUserSettingsRepository;
  let fakeOAuthRepo: FakeOAuthConnectionRepository;
  let fakeGoogleOAuthClient: FakeGoogleOAuthClient;

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
    fakeGoogleOAuthClient = new FakeGoogleOAuthClient();

    setServices({
      authTokenRepository: fakeAuthTokenRepo,
      userSettingsRepository: fakeSettingsRepo,
      oauthConnectionRepository: fakeOAuthRepo,
      auth0Client: null,
      googleOAuthClient: fakeGoogleOAuthClient,
      encryptor: null,
      llmValidator: null,
    });
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_WEB_APP_URL'];
  });

  describe('POST /oauth/connections/google/initiate', () => {
    it('returns 401 when not authenticated', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/google/initiate',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns authorization URL when authenticated', async () => {
      app = await buildServer();
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/google/initiate',
        headers: {
          authorization: `Bearer ${token}`,
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'api.example.com',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { authorizationUrl: string } };
      expect(body.success).toBe(true);
      expect(body.data.authorizationUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    });

    it('returns 503 when Google OAuth is not configured', async () => {
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        oauthConnectionRepository: fakeOAuthRepo,
        auth0Client: null,
        googleOAuthClient: null,
        encryptor: null,
        llmValidator: null,
      });

      app = await buildServer();
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/connections/google/initiate',
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

  describe('GET /oauth/connections/google/callback', () => {
    function createValidState(userId: string): string {
      const statePayload = {
        userId,
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://api.example.com/oauth/connections/google/callback',
        createdAt: Date.now(),
        nonce: 'test-nonce',
      };
      return Buffer.from(JSON.stringify(statePayload)).toString('base64url');
    }

    it('redirects with error when error parameter is present', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/callback?error=access_denied',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=access_denied');
    });

    it('redirects with error when code is missing', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/callback?state=some-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('Missing%20code%20or%20state%20parameter');
    });

    it('redirects with error when state is missing', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/callback?code=some-code',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });

    it('redirects with error when Google OAuth is not configured', async () => {
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        oauthConnectionRepository: fakeOAuthRepo,
        auth0Client: null,
        googleOAuthClient: null,
        encryptor: null,
        llmValidator: null,
      });

      app = await buildServer();
      const state = createValidState('user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/google/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('not%20configured');
    });

    it('redirects with success when exchange succeeds', async () => {
      app = await buildServer();
      const state = createValidState('user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/google/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_success=true');

      const connection = fakeOAuthRepo.getStoredConnection('user-123', 'google');
      expect(connection).toBeDefined();
      expect(connection?.email).toBe('test@example.com');
    });

    it('redirects with error when exchange fails', async () => {
      fakeGoogleOAuthClient.setFailNextExchange(true);
      app = await buildServer();
      const state = createValidState('user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/google/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });

    it('redirects with error when state is invalid', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/callback?code=auth-code&state=invalid-state',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('Invalid%20OAuth%20state');
    });

    it('redirects with error when state is expired', async () => {
      const statePayload = {
        userId: 'user-123',
        provider: OAuthProviders.GOOGLE,
        redirectUri: 'https://api.example.com/oauth/connections/google/callback',
        createdAt: Date.now() - 15 * 60 * 1000, // 15 minutes ago
        nonce: 'test-nonce',
      };
      const expiredState = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/google/callback?code=auth-code&state=${expiredState}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
      expect(response.headers.location).toContain('expired');
    });

    it('redirects with error when user info fetch fails', async () => {
      fakeGoogleOAuthClient.setFailNextUserInfo(true);
      app = await buildServer();
      const state = createValidState('user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/google/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });

    it('redirects with error when save fails', async () => {
      fakeOAuthRepo.setFailNextSave(true);
      app = await buildServer();
      const state = createValidState('user-123');

      const response = await app.inject({
        method: 'GET',
        url: `/oauth/connections/google/callback?code=auth-code&state=${state}`,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toContain('oauth_error=');
    });
  });

  describe('GET /oauth/connections/google/status', () => {
    it('returns 401 when not authenticated', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/status',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns connected=false when no connection exists', async () => {
      app = await buildServer();
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { connected: boolean; email: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(false);
      expect(body.data.email).toBeNull();
    });

    it('returns connected=true with details when connection exists', async () => {
      const userId = 'user-123';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          scope: 'calendar.readonly profile',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();
      const token = await createJwt(userId);

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          connected: boolean;
          email: string;
          scopes: string[];
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.connected).toBe(true);
      expect(body.data.email).toBe('user@example.com');
      expect(body.data.scopes).toContain('calendar.readonly');
    });

    it('returns error when repository fails', async () => {
      fakeOAuthRepo.setFailNextGetPublic(true);
      app = await buildServer();
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/connections/google/status',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('DELETE /oauth/connections/google', () => {
    it('returns 401 when not authenticated', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/google',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 503 when Google OAuth is not configured', async () => {
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        oauthConnectionRepository: fakeOAuthRepo,
        auth0Client: null,
        googleOAuthClient: null,
        encryptor: null,
        llmValidator: null,
      });

      app = await buildServer();
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/google',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(503);
    });

    it('disconnects successfully', async () => {
      const userId = 'user-123';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();
      const token = await createJwt(userId);

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/google',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const connection = fakeOAuthRepo.getStoredConnection(userId, 'google');
      expect(connection).toBeUndefined();
    });

    it('succeeds even when revoke fails', async () => {
      const userId = 'user-123';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeGoogleOAuthClient.setFailNextRevoke(true);

      app = await buildServer();
      const token = await createJwt(userId);

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/google',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const connection = fakeOAuthRepo.getStoredConnection(userId, 'google');
      expect(connection).toBeUndefined();
    });

    it('returns error when delete fails', async () => {
      const userId = 'user-123';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeOAuthRepo.setFailNextDelete(true);

      app = await buildServer();
      const token = await createJwt(userId);

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/google',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns error when getConnection fails', async () => {
      fakeOAuthRepo.setFailNextGet(true);

      app = await buildServer();
      const token = await createJwt('user-123');

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/google',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(500);
    });

    it('succeeds even when no connection exists (no-op)', async () => {
      app = await buildServer();
      const token = await createJwt('user-no-connection');

      const response = await app.inject({
        method: 'DELETE',
        url: '/oauth/connections/google',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });
  });
});
