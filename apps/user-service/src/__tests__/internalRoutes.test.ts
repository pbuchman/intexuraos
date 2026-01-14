/**
 * Tests for internal routes (service-to-service communication):
 * - GET /internal/users/:uid/llm-keys
 * - GET /internal/users/:uid/settings
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { LlmModels } from '@intexuraos/llm-contract';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import {
  FakeAuthTokenRepository,
  FakeEncryptor,
  FakeUserSettingsRepository,
  FakeOAuthConnectionRepository,
  FakeGoogleOAuthClient,
} from './fakes.js';
import { OAuthProviders } from '../domain/oauth/index.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';
const INTERNAL_AUTH_TOKEN = 'test-internal-auth-token';

describe('Internal Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let jwksUrl: string;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  let fakeAuthTokenRepo: FakeAuthTokenRepository;
  let fakeSettingsRepo: FakeUserSettingsRepository;
  let fakeEncryptor: FakeEncryptor;
  let fakeOAuthRepo: FakeOAuthConnectionRepository;
  let fakeGoogleOAuthClient: FakeGoogleOAuthClient;

  beforeAll(async () => {
    const { publicKey } = await jose.generateKeyPair('RS256');

    const publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    jwksServer = Fastify({ logger: false });

    jwksServer.get('/.well-known/jwks.json', async (_req, reply) => {
      return await reply.send({
        keys: [publicKeyJwk],
      });
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
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;

    clearJwksCache();

    fakeAuthTokenRepo = new FakeAuthTokenRepository();
    fakeSettingsRepo = new FakeUserSettingsRepository();
    fakeEncryptor = new FakeEncryptor();
    fakeOAuthRepo = new FakeOAuthConnectionRepository();
    fakeGoogleOAuthClient = new FakeGoogleOAuthClient();
    setServices({
      authTokenRepository: fakeAuthTokenRepo,
      userSettingsRepository: fakeSettingsRepo,
      oauthConnectionRepository: fakeOAuthRepo,
      auth0Client: null,
      googleOAuthClient: fakeGoogleOAuthClient,
      encryptor: fakeEncryptor,
      llmValidator: null,
    });
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
  });

  describe('GET /internal/users/:uid/llm-keys', () => {
    it('returns 401 when no internal auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/llm-keys',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when internal auth token is wrong', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/llm-keys',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns null for all providers when no keys configured', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-no-keys/llm-keys',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        google: string | null;
        openai: string | null;
        anthropic: string | null;
      };
      // Returns null (not undefined) to ensure JSON serialization preserves the key
      expect(body.google).toBeNull();
      expect(body.openai).toBeNull();
      expect(body.anthropic).toBeNull();
    });

    it('returns decrypted keys for configured providers', async () => {
      const userId = 'user-with-keys';
      const googleKey = 'AIzaSyB1234567890abcdefghij';
      const anthropicKey = 'sk-ant-api1234567890abcd';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(googleKey).toString('base64') },
          anthropic: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(anthropicKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/llm-keys`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        google: string | null;
        openai: string | null;
        anthropic: string | null;
      };
      // Returns decrypted keys for service-to-service use
      expect(body.google).toBe(googleKey);
      expect(body.openai).toBeNull();
      expect(body.anthropic).toBe(anthropicKey);
    });

    it('returns empty when repository fails', async () => {
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-error/llm-keys',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        google: string | null;
        openai: string | null;
        anthropic: string | null;
      };
      expect(body.google).toBeNull();
      expect(body.openai).toBeNull();
      expect(body.anthropic).toBeNull();
    });

    it('returns 401 when INTEXURAOS_INTERNAL_AUTH_TOKEN is not configured', async () => {
      delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/llm-keys',
        headers: {
          'x-internal-auth': 'any-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns undefined for keys when decryption fails', async () => {
      const userId = 'user-decrypt-fail';
      const googleKey = 'AIzaSyB1234567890abcdefghij';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(googleKey).toString('base64') },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      // Make the first decryption fail (for google)
      fakeEncryptor.setFailNextDecrypt(true);

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/llm-keys`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        google: string | null;
        openai: string | null;
        anthropic: string | null;
      };
      // Google key should be null due to decryption failure
      expect(body.google).toBeNull();
    });
  });

  describe('POST /internal/users/:uid/llm-keys/:provider/last-used', () => {
    it('returns 401 when no internal auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/users/user-123/llm-keys/google/last-used',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('updates llm last used timestamp for valid request', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/internal/users/user-123/llm-keys/anthropic/last-used',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
    });
  });

  describe('GET /internal/users/:uid/oauth/google/token', () => {
    it('returns 401 when no internal auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/oauth/google/token',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when internal auth token is wrong', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/oauth/google/token',
        headers: {
          'x-internal-auth': 'wrong-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 500 when Google OAuth is not configured', async () => {
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        oauthConnectionRepository: fakeOAuthRepo,
        auth0Client: null,
        googleOAuthClient: null,
        encryptor: fakeEncryptor,
        llmValidator: null,
      });

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/oauth/google/token',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: string; code: string };
      expect(body.code).toBe('CONFIGURATION_ERROR');
    });

    it('returns 404 when no connection exists', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-no-connection/oauth/google/token',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: string; code: string };
      expect(body.code).toBe('CONNECTION_NOT_FOUND');
    });

    it('returns valid access token when connection exists and token is fresh', async () => {
      const userId = 'user-with-token';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'valid-access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/oauth/google/token`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { accessToken: string; email: string };
      expect(body.accessToken).toBe('valid-access-token');
      expect(body.email).toBe('user@example.com');
    });

    it('refreshes token when expired and returns new token', async () => {
      const userId = 'user-expired-token';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() - 60000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/oauth/google/token`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { accessToken: string; email: string };
      expect(body.accessToken).toBe('new-fake-access-token');
    });

    it('returns 500 when refresh fails', async () => {
      const userId = 'user-refresh-fail';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() - 60000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeGoogleOAuthClient.setFailNextRefresh(true);

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/oauth/google/token`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { code: string };
      expect(body.code).toBe('TOKEN_REFRESH_FAILED');
    });

    it('returns 404 and deletes connection when refresh returns invalid_grant', async () => {
      const userId = 'user-invalid-grant';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() - 60000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeGoogleOAuthClient.setFailNextRefresh(true, {
        code: 'INVALID_GRANT',
        message: 'Refresh failed',
        details: '{"error": "invalid_grant"}',
      });

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/oauth/google/token`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { code: string };
      expect(body.code).toBe('CONNECTION_NOT_FOUND');

      const connection = fakeOAuthRepo.getStoredConnection(userId, 'google');
      expect(connection).toBeUndefined();
    });

    it('returns 500 when getConnection fails', async () => {
      fakeOAuthRepo.setFailNextGet(true);

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-error/oauth/google/token',
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { code: string };
      expect(body.code).toBe('INTERNAL_ERROR');
    });

    it('still returns token when updateTokens fails after refresh', async () => {
      const userId = 'user-update-fail';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'refresh-token',
          expiresAt: new Date(Date.now() - 60000).toISOString(),
          scope: 'calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeOAuthRepo.setFailNextUpdate(true);

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/oauth/google/token`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { accessToken: string; email: string };
      expect(body.accessToken).toBe('new-fake-access-token');
      expect(body.email).toBe('user@example.com');
    });

    it('uses existing refreshToken and scope when refresh does not return them', async () => {
      const userId = 'user-partial-refresh';
      fakeOAuthRepo.setConnection(userId, 'google', {
        userId,
        provider: OAuthProviders.GOOGLE,
        email: 'user@example.com',
        tokens: {
          accessToken: 'expired-access-token',
          refreshToken: 'original-refresh-token',
          expiresAt: new Date(Date.now() - 60000).toISOString(),
          scope: 'original-scope calendar.readonly',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeGoogleOAuthClient.setCustomRefreshResponse({
        accessToken: 'new-access-from-partial-refresh',
        expiresIn: 3600,
      });

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/oauth/google/token`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { accessToken: string; email: string };
      expect(body.accessToken).toBe('new-access-from-partial-refresh');

      const updatedConnection = fakeOAuthRepo.getStoredConnection(userId, 'google');
      expect(updatedConnection?.tokens.refreshToken).toBe('original-refresh-token');
      expect(updatedConnection?.tokens.scope).toBe('original-scope calendar.readonly');
    });
  });

  describe('GET /internal/users/:uid/settings', () => {
    it('returns 401 when no internal auth header', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/settings',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns 401 when internal auth header is invalid', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/internal/users/user-123/settings',
        headers: {
          'x-internal-auth': 'invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns user llmPreferences when valid auth header', async () => {
      const userId = 'user-with-settings';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: {
          defaultModel: LlmModels.Gemini25Flash,
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/settings`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        llmPreferences?: { defaultModel: string };
      };
      expect(body.llmPreferences?.defaultModel).toBe(LlmModels.Gemini25Flash);
    });

    it('returns undefined llmPreferences when user has no settings', async () => {
      const userId = 'user-no-settings';
      // Don't set any settings - the repo will return null

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/settings`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        llmPreferences?: { defaultModel: string };
      };
      expect(body.llmPreferences).toBeUndefined();
    });

    it('returns undefined llmPreferences when repository errors', async () => {
      const userId = 'user-error';
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: `/internal/users/${userId}/settings`,
        headers: {
          'x-internal-auth': INTERNAL_AUTH_TOKEN,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        llmPreferences?: { defaultModel: string };
      };
      expect(body.llmPreferences).toBeUndefined();
    });
  });
});
