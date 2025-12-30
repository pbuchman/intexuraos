/**
 * Tests for GET /users/:uid/settings, PATCH /users/:uid/settings
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { FakeAuthTokenRepository, FakeUserSettingsRepository } from './fakes.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = 'test-client-id';
const AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('Settings Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  const issuer = `https://${AUTH0_DOMAIN}/`;

  let fakeAuthTokenRepo: FakeAuthTokenRepository;
  let fakeSettingsRepo: FakeUserSettingsRepository;

  async function createToken(claims: Record<string, unknown>): Promise<string> {
    const builder = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(AUTH_AUDIENCE)
      .setExpirationTime('1h');

    return await builder.sign(privateKey);
  }

  beforeAll(async () => {
    // Generate RSA key pair for testing
    const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
    privateKey = privKey;

    // Export public key as JWK
    const publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = 'test-key-1';
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';

    // Start local JWKS server
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
    process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
    process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
    process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
    process.env['AUTH_JWKS_URL'] = jwksUrl;
    process.env['AUTH_ISSUER'] = issuer;

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
          notifications: { filters: { app: string }[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe('auth0|new-user');
      expect(body.data.notifications.filters).toEqual([]);
    });

    it('returns existing settings', { timeout: 20000 }, async () => {
      const userId = 'auth0|existing-user';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: {
          filters: [
            { name: 'WhatsApp', app: 'com.whatsapp' },
            { name: 'Slack', app: 'com.slack' },
          ],
        },
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
          notifications: { filters: { name: string; app?: string }[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(userId);
      expect(body.data.notifications.filters).toEqual([
        { name: 'WhatsApp', app: 'com.whatsapp' },
        { name: 'Slack', app: 'com.slack' },
      ]);
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
          notifications: { filters: [] },
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
          notifications: { filters: [] },
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
          notifications: { filters: [{ name: 'WhatsApp', app: 'com.whatsapp' }] },
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

    it('creates new settings for new user', { timeout: 20000 }, async () => {
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
          notifications: { filters: [{ name: 'WhatsApp', app: 'com.whatsapp' }] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          notifications: { filters: { name: string; app?: string }[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe(userId);
      expect(body.data.notifications.filters).toEqual([{ name: 'WhatsApp', app: 'com.whatsapp' }]);

      // Verify it was saved
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored).toBeDefined();
      expect(stored?.notifications.filters).toEqual([{ name: 'WhatsApp', app: 'com.whatsapp' }]);
    });

    it('updates existing settings', { timeout: 20000 }, async () => {
      const userId = 'auth0|existing-patch-user';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: {
          filters: [{ name: 'OldApp', app: 'com.old-app' }],
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
          notifications: {
            filters: [
              { name: 'NewApp', app: 'com.new-app' },
              { name: 'AnotherApp', app: 'com.another-app' },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          notifications: { filters: { name: string; app: string }[] };
          createdAt: string;
          updatedAt: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications.filters).toEqual([
        { name: 'NewApp', app: 'com.new-app' },
        { name: 'AnotherApp', app: 'com.another-app' },
      ]);
      // Should preserve original createdAt
      expect(body.data.createdAt).toBe('2025-01-01T00:00:00.000Z');
      // updatedAt should be different
      expect(body.data.updatedAt).not.toBe('2025-01-01T00:00:00.000Z');
    });

    it('returns 400 when body is invalid', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-bad-body',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|user-bad-body/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          invalid: 'body',
        },
      });

      expect(response.statusCode).toBe(400);
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
          notifications: { filters: [{ name: 'TestFilter', app: 'com.test' }] },
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
          notifications: { filters: [{ name: 'TestFilter', app: 'com.test' }] },
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

    it('returns 400 when filter names are duplicated', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-dup-names',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|user-dup-names/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          notifications: {
            filters: [
              { name: 'MyFilter', app: 'com.app1' },
              { name: 'MyFilter', app: 'com.app2' },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('Duplicate filter name');
    });

    it('returns 400 when filter has no criteria', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-no-criteria',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|user-no-criteria/settings',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          notifications: {
            filters: [{ name: 'EmptyFilter' }],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('must have at least one criterion');
    });

    it('accepts filter with source criterion only', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-source-only';
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
          notifications: {
            filters: [{ name: 'SourceFilter', source: 'tasker' }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          notifications: { filters: { name: string; source: string }[] };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications.filters).toEqual([{ name: 'SourceFilter', source: 'tasker' }]);
    });

    it('accepts filter with title criterion only', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-title-only';
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
          notifications: {
            filters: [{ name: 'TitleFilter', title: 'important' }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          notifications: { filters: { name: string; title: string }[] };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications.filters).toEqual([
        { name: 'TitleFilter', title: 'important' },
      ]);
    });

    it('accepts filter with multiple criteria', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-multi-criteria';
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
          notifications: {
            filters: [
              { name: 'MultiFilter', app: 'com.whatsapp', source: 'tasker', title: 'urgent' },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          notifications: {
            filters: { name: string; app: string; source: string; title: string }[];
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications.filters).toEqual([
        { name: 'MultiFilter', app: 'com.whatsapp', source: 'tasker', title: 'urgent' },
      ]);
    });

    it('allows clearing all filters (empty array)', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-clear-filters';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: {
          filters: [
            { name: 'Filter1', app: 'com.app1' },
            { name: 'Filter2', app: 'com.app2' },
          ],
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
          notifications: { filters: [] },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          notifications: { filters: unknown[] };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications.filters).toEqual([]);
    });

    it('allows adding multiple filters at once', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-multi-add';
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
          notifications: {
            filters: [
              {
                name: 'android auto',
                app: 'com.google.android.projection.gearhead',
                source: 'tasker',
                title: 'looking',
              },
              { name: 'whatsapp', app: 'com.whatsapp', title: 'looking' },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          notifications: {
            filters: { name: string; app?: string; source?: string; title?: string }[];
          };
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.notifications.filters).toHaveLength(2);
      expect(body.data.notifications.filters[0]?.name).toBe('android auto');
      expect(body.data.notifications.filters[1]?.name).toBe('whatsapp');
    });

    it(
      'handles string payload (Fastify auto-parses JSON strings)',
      { timeout: 20000 },
      async () => {
        // Note: Fastify's inject() with string payload automatically parses it as JSON
        // So this test verifies normal behavior - in real HTTP, double-stringified JSON
        // would be rejected at the body validation level because the body schema
        // expects an object with { notifications: { filters: [] } }
        app = await buildServer();

        const userId = 'auth0|user-string-payload';
        const token = await createToken({
          sub: userId,
        });

        // When using inject with a string payload, Fastify parses it as JSON
        const response = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          payload: JSON.stringify({ notifications: { filters: [] } }),
        });

        // Fastify inject() auto-parses the string, so this actually works
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { notifications: { filters: unknown[] } };
        };
        expect(body.success).toBe(true);
        expect(body.data.notifications.filters).toEqual([]);
      }
    );
  });
});
