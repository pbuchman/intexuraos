/**
 * Tests for GET /users/:uid/settings
 */
import { LlmModels } from '@intexuraos/llm-contract';
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
  FakeUserSettingsRepository,
} from './fakes.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('Settings Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  let fakeAuthTokenRepo: FakeAuthTokenRepository;
  let fakeSettingsRepo: FakeUserSettingsRepository;

  async function createToken(claims: Record<string, unknown>): Promise<string> {
    const builder = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(INTEXURAOS_AUTH_AUDIENCE)
      .setExpirationTime('1h');

    return await builder.sign(privateKey);
  }

  beforeAll(async () => {
    const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
    privateKey = privKey;

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

    clearJwksCache();

    fakeAuthTokenRepo = new FakeAuthTokenRepository();
    fakeSettingsRepo = new FakeUserSettingsRepository();
    setServices({
      authTokenRepository: fakeAuthTokenRepo,
      userSettingsRepository: fakeSettingsRepo,
      auth0Client: null,
      encryptor: null,
      llmValidator: null,
      oauthConnectionRepository: new FakeOAuthConnectionRepository(),
      googleOAuthClient: null,
      gitHubOAuthClient: null,
    });
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /users/:uid/settings', () => {
    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/users/user-123/settings',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when token is invalid', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/users/user-123/settings',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when accessing another user settings', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-123',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/users/auth0|other-user/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('You can only access your own settings');
    });

    it('returns default settings for new user', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|new-user',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/users/auth0|new-user/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe('auth0|new-user');
    });

    it('returns existing settings', { timeout: 20000 }, async () => {
      const userId = 'auth0|existing-user';
      fakeSettingsRepo.setSettings({
        userId,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-15T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({
        sub: userId,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(userId);
      expect(body.data.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(body.data.updatedAt).toBe('2025-01-15T00:00:00.000Z');
    });

    it('returns 500 when repository fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-error',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/users/auth0|user-error/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /users/:uid/settings', () => {
    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/user-123/settings',
        payload: { defaultModel: LlmModels.Gemini25Flash },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when updating another user settings', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({ sub: 'auth0|user-123' });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|other-user/settings',
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LlmModels.Gemini25Flash },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 400 for invalid model', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-invalid-model';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LlmModels.GPTImage1 },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain(LlmModels.GPTImage1);
    });

    it('returns 400 for completely invalid model string', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-bad-model';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: 'not-a-model' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });

    it('returns 400 when no API key for model provider', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-no-api-key';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LlmModels.Gemini25Flash },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('no API key configured');
      expect(body.error.message).toContain('google');
    });

    it('returns 200 and saves valid fast model when API key is configured', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-set-model';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LlmModels.Gemini25Flash },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { defaultModel: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.defaultModel).toBe(LlmModels.Gemini25Flash);

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.defaultModel).toBe(LlmModels.Gemini25Flash);
    });

    it('returns 500 when repository update fails', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-repo-fail';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      fakeSettingsRepo.setFailNextUpdateLlmPreferences(true);

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LlmModels.Gemini20Flash },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when getSettings fails during API key check', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const userId = 'auth0|user-get-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LlmModels.Gemini25Flash },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
