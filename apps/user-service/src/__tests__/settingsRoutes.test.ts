/**
 * Tests for GET /users/:uid/settings, PATCH /users/:uid/settings
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { FakeAuthTokenRepository, FakeUserSettingsRepository } from './fakes.js';

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
          researchSettings?: { defaultModels?: string[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe('auth0|new-user');
      expect(body.data.researchSettings).toBeUndefined();
    });

    it('returns existing settings', { timeout: 20000 }, async () => {
      const userId = 'auth0|existing-user';
      fakeSettingsRepo.setSettings({
        userId,
        researchSettings: { defaultModels: ['gemini-2.5-flash'] },
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
          researchSettings: { defaultModels: string[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(userId);
      expect(body.data.researchSettings.defaultModels).toEqual(['gemini-2.5-flash']);
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
        payload: {
          researchSettings: { defaultModels: ['gemini-2.5-flash'] },
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

    it('returns 401 when token is invalid', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/user-123/settings',
        headers: {
          authorization: 'Bearer invalid-token',
        },
        payload: {
          researchSettings: { defaultModels: ['gemini-2.5-flash'] },
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

    it('returns 403 when updating another user settings', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-123',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|other-user/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchSettings: { defaultModels: ['gemini-2.5-flash'] },
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('You can only update your own settings');
    });

    it('creates new settings for new user with researchSettings', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|new-patch-user';
      const token = await createToken({
        sub: userId,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchSettings: { defaultModels: ['gemini-2.5-flash'] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          researchSettings: { defaultModels: string[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(userId);
      expect(body.data.researchSettings.defaultModels).toEqual(['gemini-2.5-flash']);

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored).toBeDefined();
      expect(stored?.researchSettings?.defaultModels).toEqual(['gemini-2.5-flash']);
    });

    it('updates existing settings with new defaultModels', { timeout: 20000 }, async () => {
      const userId = 'auth0|existing-patch-user';
      fakeSettingsRepo.setSettings({
        userId,
        researchSettings: { defaultModels: ['gemini-2.5-flash'] },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({
        sub: userId,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchSettings: { defaultModels: ['gemini-2.5-pro', 'claude-opus-4-5-20251101'] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          researchSettings: { defaultModels: string[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchSettings.defaultModels).toEqual(['gemini-2.5-pro', 'claude-opus-4-5-20251101']);
      expect(body.data.createdAt).toBe('2025-01-01T00:00:00.000Z');
      expect(body.data.updatedAt).not.toBe('2025-01-01T00:00:00.000Z');
    });

    it('returns 400 when defaultModels contains invalid model', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-invalid-mode',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|user-invalid-mode/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchSettings: { defaultModels: ['invalid-model'] },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('allows empty body (no changes)', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-empty-body';
      fakeSettingsRepo.setSettings({
        userId,
        researchSettings: { defaultModels: ['gemini-2.5-pro'] },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({
        sub: userId,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          researchSettings: { defaultModels: string[] };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.researchSettings.defaultModels).toEqual(['gemini-2.5-pro']);
    });

    it('returns 500 when get fails during update', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-get-error',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|user-get-error/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchSettings: { defaultModels: ['gemini-2.5-flash'] },
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

    it('returns 500 when save fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextSave(true);

      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-save-error',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|user-save-error/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          researchSettings: { defaultModels: ['gemini-2.5-flash'] },
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

    it(
      'preserves existing llmApiKeys when updating researchSettings',
      { timeout: 20000 },
      async () => {
        const userId = 'auth0|user-preserve-keys';
        fakeSettingsRepo.setSettings({
          userId,
          researchSettings: { defaultModels: ['gemini-2.5-pro'] },
          llmApiKeys: {
            google: { ciphertext: 'encrypted-key', iv: 'test-iv', tag: 'test-tag' },
          },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        });

        app = await buildServer();

        const token = await createToken({
          sub: userId,
        });

        const response = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: {
            authorization: `Bearer ${token}`,
          },
          payload: {
            researchSettings: { defaultModels: ['gemini-2.5-flash'] },
          },
        });

        expect(response.statusCode).toBe(200);

        const stored = fakeSettingsRepo.getStoredSettings(userId);
        expect(stored?.llmApiKeys?.google).toBeDefined();
        expect(stored?.researchSettings?.defaultModels).toEqual(['gemini-2.5-flash']);
      }
    );

    it(
      'handles string payload (Fastify auto-parses JSON strings)',
      { timeout: 20000 },
      async () => {
        app = await buildServer();

        const userId = 'auth0|user-string-payload';
        const token = await createToken({
          sub: userId,
        });

        const response = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload: JSON.stringify({ researchSettings: { defaultModels: ['gemini-2.5-flash'] } }),
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { researchSettings: { defaultModels: string[] } };
        };
        expect(body.success).toBe(true);
        expect(body.data.researchSettings.defaultModels).toEqual(['gemini-2.5-flash']);
      }
    );
  });
});
