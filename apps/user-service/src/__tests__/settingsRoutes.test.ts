/**
 * Tests for GET /users/:uid/settings
 */
import {
  IntexAgentModels,
  LegacyGoogleModels,
  LlmModels,
  LlmProviders,
} from '@intexuraos/llm-contract';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
      const capability = vi.fn(async () => true);
      const getSettings = vi.spyOn(fakeSettingsRepo, 'getSettings');
      setServices({
        intexAgentTestRunsReadCapability: { isAvailableForUser: capability },
      });
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
      expect(capability).not.toHaveBeenCalled();
      expect(getSettings).not.toHaveBeenCalled();
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
      const capability = vi.fn(async () => true);
      const getSettings = vi.spyOn(fakeSettingsRepo, 'getSettings');
      setServices({
        intexAgentTestRunsReadCapability: { isAvailableForUser: capability },
      });
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
      expect(capability).not.toHaveBeenCalled();
      expect(getSettings).not.toHaveBeenCalled();
    });

    it('returns default settings for new user', { timeout: 20000 }, async () => {
      setServices({
        intexAgentTestRunsReadCapability: {
          isAvailableForUser: async (candidate) => candidate === 'auth0|new-user',
        },
      });
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
      expect((body.data as unknown as { intexAgentCapabilities: unknown }).intexAgentCapabilities)
        .toEqual({ testRuns: { status: 'available', runtimeAudience: 'hetzner-prod' } });
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
      expect((body.data as unknown as { intexAgentCapabilities: unknown }).intexAgentCapabilities)
        .toEqual({ testRuns: { status: 'unavailable' } });
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
    it.each([
      { name: 'null', payload: null },
      { name: 'array', payload: [] },
      { name: 'string', payload: 'not-an-object' },
      { name: 'number', payload: 7 },
      { name: 'boolean', payload: true },
      { name: 'empty object', payload: {} },
      { name: 'unknown object', payload: { unknown: true } },
      {
        name: 'mixed selector/general object',
        payload: {
          defaultModel: LlmModels.GPT4oMini,
          intexAgentModel: IntexAgentModels.DeepSeekV4Flash,
          expectedRevision: 0,
        },
      },
      {
        name: 'selector object with unknown extra field',
        payload: {
          intexAgentModel: IntexAgentModels.DeepSeekV4Flash,
          expectedRevision: 0,
          unknown: true,
        },
      },
    ])(
      'orders 401, 403, then unavailable 404 before validation for $name',
      { timeout: 20000 },
      async ({ payload }) => {
        const userId = 'auth0|selector-order-user';
        const availability = vi.fn(async () => false);
        const getSettings = vi.spyOn(fakeSettingsRepo, 'getSettings');
        const selectorRead = vi.spyOn(fakeSettingsRepo, 'getIntexAgentModelState');
        const selectorWrite = vi.spyOn(fakeSettingsRepo, 'updateIntexAgentModel');
        const generalWrite = vi.spyOn(fakeSettingsRepo, 'updateLlmPreferences');
        setServices({
          intexAgentModelAvailability: {
            start: () => Promise.resolve(),
            isAvailableForUser: availability,
          },
        });
        app = await buildServer();
        const wirePayload = JSON.stringify(payload);

        const unauthenticated = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: { 'content-type': 'application/json' },
          payload: wirePayload,
        });
        expect(unauthenticated.statusCode).toBe(401);
        expect(availability).not.toHaveBeenCalled();

        const token = await createToken({ sub: userId });
        const forbidden = await app.inject({
          method: 'PATCH',
          url: '/users/auth0%7Cforeign/settings',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: wirePayload,
        });
        expect(forbidden.statusCode).toBe(403);
        expect(availability).not.toHaveBeenCalled();

        const unavailable = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: wirePayload,
        });
        expect(unavailable.statusCode).toBe(404);
        expect((JSON.parse(unavailable.body) as { error: unknown }).error).toEqual({
          code: 'NOT_FOUND',
          message: 'Intex Agent model selector is unavailable',
        });
        expect(availability).toHaveBeenCalledTimes(1);
        expect(availability).toHaveBeenCalledWith(userId);
        expect(getSettings).not.toHaveBeenCalled();
        expect(selectorRead).not.toHaveBeenCalled();
        expect(selectorWrite).not.toHaveBeenCalled();
        expect(generalWrite).not.toHaveBeenCalled();
      }
    );

    it('updates the independent selector without a BYOK key', { timeout: 20000 }, async () => {
      const userId = 'auth0|selector-write-user';
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async (candidate) => candidate === userId,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { intexAgentModel: IntexAgentModels.Gemini3FlashPreview, expectedRevision: 0 },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: unknown };
      expect(body.data).toEqual({
        explicitModel: IntexAgentModels.Gemini3FlashPreview,
        effectiveModel: IntexAgentModels.Gemini3FlashPreview,
        source: 'explicit',
        revision: 1,
      });
    });

    it.each([null, [], 'not-an-object', 7, true, {}, { unknown: true }, { defaultModel: 'x', intexAgentModel: null }])(
      'returns the static selector validation error for available non-general body %j',
      { timeout: 20000 },
      async (payload) => {
        const userId = 'auth0|invalid-selector-user';
        setServices({
          intexAgentModelAvailability: {
            start: () => Promise.resolve(),
            isAvailableForUser: async () => true,
          },
        });
        app = await buildServer();
        const token = await createToken({ sub: userId });

        const response = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: JSON.stringify(payload),
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as { error: { code: string; message: string } };
        expect(body.error).toEqual({
          code: 'INVALID_REQUEST',
          message: 'Invalid Intex Agent model selector request',
        });
      }
    );

    it('keeps an invalid unambiguous general candidate on the legacy path without selector calls', { timeout: 20000 }, async () => {
      const userId = 'auth0|legacy-general-user';
      const availability = vi.fn(async () => false);
      const selectorRead = vi.spyOn(fakeSettingsRepo, 'getIntexAgentModelState');
      const selectorWrite = vi.spyOn(fakeSettingsRepo, 'updateIntexAgentModel');
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: availability,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: 'not-a-model' },
      });

      expect(response.statusCode).toBe(400);
      expect(availability).not.toHaveBeenCalled();
      expect(selectorRead).not.toHaveBeenCalled();
      expect(selectorWrite).not.toHaveBeenCalled();
    });

    it.each(['disabled', 'catalog-startup-failed', 'catalog-refresh-failed'])(
      'keeps valid general BYOK updates independent of selector state: %s',
      async () => {
        const userId = 'auth0|legacy-general-success';
        fakeSettingsRepo.setSettings({
          userId,
          llmApiKeys: { openai: { iv: 'iv', tag: 'tag', ciphertext: 'ciphertext' } },
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        });
        const availability = vi.fn(async () => false);
        const selectorRead = vi.spyOn(fakeSettingsRepo, 'getIntexAgentModelState');
        const selectorWrite = vi.spyOn(fakeSettingsRepo, 'updateIntexAgentModel');
        setServices({
          intexAgentModelAvailability: {
            start: () => Promise.resolve(),
            isAvailableForUser: availability,
          },
        });
        app = await buildServer();
        const token = await createToken({ sub: userId });
        const response = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: { authorization: `Bearer ${token}` },
          payload: { defaultModel: LlmModels.GPT4oMini },
        });
        expect(response.statusCode).toBe(200);
        expect(availability).not.toHaveBeenCalled();
        expect(selectorRead).not.toHaveBeenCalled();
        expect(selectorWrite).not.toHaveBeenCalled();
      }
    );

    it('maps selector conflicts to the frozen CONFLICT envelope', { timeout: 20000 }, async () => {
      const userId = 'auth0|selector-conflict-user';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: { intexAgentModelRevision: 2 },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async () => true,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { intexAgentModel: IntexAgentModels.DeepSeekV4Flash, expectedRevision: 1 },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { error: { code: string; message: string; details: unknown } };
      expect(body.error).toEqual({
        code: 'CONFLICT',
        message: 'Revision conflict',
        details: { currentRevision: 2 },
      });
    });

    it('resets and idempotently resets the independent selector', { timeout: 20000 }, async () => {
      const userId = 'auth0|selector-reset-user';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: { intexAgentModel: IntexAgentModels.MiniMaxM3, intexAgentModelRevision: 1 },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async () => true,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });
      const request = async (
        expectedRevision: number
      ): Promise<import('fastify').LightMyRequestResponse> =>
        await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: { authorization: `Bearer ${token}` },
          payload: { intexAgentModel: null, expectedRevision },
        });

      const reset = await request(1);
      expect(reset.statusCode).toBe(200);
      expect((JSON.parse(reset.body) as { data: unknown }).data).toEqual({
        explicitModel: null,
        effectiveModel: IntexAgentModels.DeepSeekV4Flash,
        source: 'default_absent',
        revision: 2,
      });
      const idempotent = await request(2);
      expect(idempotent.statusCode).toBe(200);
      expect((JSON.parse(idempotent.body) as { data: { revision: number } }).data.revision).toBe(2);
    });

    it.each([
      { intexAgentModel: 'deepseek/deepseek-v4-flash', expectedRevision: 0 },
      { intexAgentModel: IntexAgentModels.DeepSeekV4Flash },
      { intexAgentModel: IntexAgentModels.DeepSeekV4Flash, expectedRevision: -1 },
      { intexAgentModel: IntexAgentModels.DeepSeekV4Flash, expectedRevision: 0.5 },
      { intexAgentModel: IntexAgentModels.DeepSeekV4Flash, expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    ])('rejects invalid closed selector body %j', async (payload) => {
      const userId = 'auth0|invalid-selector-patch';
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async () => true,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });
      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect((JSON.parse(response.body) as { error: unknown }).error).toEqual({
        code: 'INVALID_REQUEST',
        message: 'Invalid Intex Agent model selector request',
      });
    });

    it('maps exhausted, invalid stored, and repository update failures to frozen selector errors', { timeout: 20000 }, async () => {
      const userId = 'auth0|selector-failure-user';
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async () => true,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });
      const patch = async (): Promise<import('fastify').LightMyRequestResponse> =>
        await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings`,
          headers: { authorization: `Bearer ${token}` },
          payload: { intexAgentModel: IntexAgentModels.MiniMaxM3, expectedRevision: Number.MAX_SAFE_INTEGER },
        });

      fakeSettingsRepo.setRawIntexAgentModelState(userId, {
        intexAgentModel: IntexAgentModels.DeepSeekV4Flash,
        intexAgentModelRevision: Number.MAX_SAFE_INTEGER,
      });
      const exhausted = await patch();
      expect((JSON.parse(exhausted.body) as { error: unknown }).error).toEqual({
        code: 'CONFLICT',
        message: 'Revision exhausted',
        details: { currentRevision: Number.MAX_SAFE_INTEGER },
      });

      fakeSettingsRepo.setRawIntexAgentModelState(userId, { intexAgentModel: 'forged' });
      const invalid = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { intexAgentModel: IntexAgentModels.MiniMaxM3, expectedRevision: 0 },
      });
      expect((JSON.parse(invalid.body) as { error: unknown }).error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Intex Agent model selector state is invalid',
      });

      fakeSettingsRepo.setRawIntexAgentModelState(userId, {});
      fakeSettingsRepo.setFailNextUpdateIntexAgentModel(true);
      const failed = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { intexAgentModel: IntexAgentModels.MiniMaxM3, expectedRevision: 0 },
      });
      expect((JSON.parse(failed.body) as { error: unknown }).error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Failed to update Intex Agent model selector',
      });
    });

    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/user-123/settings',
        payload: { defaultModel: LlmModels.GPT4oMini },
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
        payload: { defaultModel: LlmModels.GPT4oMini },
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

    it('returns 400 for a raw legacy Google model', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-no-api-key';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LegacyGoogleModels.Gemini25Flash },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain(LegacyGoogleModels.Gemini25Flash);
      expect(body.error.message).toContain('supported model');
    });

    it('returns 400 when the selected provider has no API key', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-without-openai-key';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings`,
        headers: { authorization: `Bearer ${token}` },
        payload: { defaultModel: LlmModels.GPT4oMini },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain(
        `no API key configured for provider '${LlmProviders.OpenAI}'`
      );
    });

    it('returns 200 and saves valid fast model when API key is configured', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-set-model';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
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
        payload: { defaultModel: LlmModels.GPT4oMini },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { defaultModel: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.defaultModel).toBe(LlmModels.GPT4oMini);

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.defaultModel).toBe(LlmModels.GPT4oMini);
    });

    it('returns 500 when repository update fails', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-repo-fail';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
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
        payload: { defaultModel: LlmModels.GPT4oMini },
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
        payload: { defaultModel: LlmModels.GPT4oMini },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('accepts OpenRouter model as defaultModel', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-openrouter-default';
      const orModel = 'or:google/gemma-4-31b-it:free';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-or-key').toString('base64') },
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
        payload: { defaultModel: orModel },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { defaultModel: string; fallbackModel: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.defaultModel).toBe(orModel);
      expect(body.data.fallbackModel).toBeNull();

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.defaultModel).toBe(orModel);
    });

    it('accepts fallbackModel alongside defaultModel', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-with-fallback';
      const orFallback = 'or:google/gemma-4-31b-it:free';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-openai-key').toString('base64') },
          openrouter: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-or-key').toString('base64') },
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
        payload: { defaultModel: LlmModels.GPT4oMini, fallbackModel: orFallback },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { defaultModel: string; fallbackModel: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.defaultModel).toBe(LlmModels.GPT4oMini);
      expect(body.data.fallbackModel).toBe(orFallback);

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.defaultModel).toBe(LlmModels.GPT4oMini);
      expect(stored?.llmPreferences?.fallbackModel).toBe(orFallback);
    });

    it('clears fallbackModel when null is passed', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-clear-fallback';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
        },
        llmPreferences: {
          defaultModel: LlmModels.GPT4oMini,
          fallbackModel: 'or:google/gemma-4-31b-it:free',
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
        payload: { defaultModel: LlmModels.GPT4oMini, fallbackModel: null },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { defaultModel: string; fallbackModel: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.fallbackModel).toBeNull();

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.fallbackModel).toBeUndefined();
    });

    it('rejects invalid fallbackModel', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-invalid-fallback';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
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
        payload: { defaultModel: LlmModels.GPT4oMini, fallbackModel: 'not-a-real-model' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('not-a-real-model');
    });

    it('rejects fallbackModel same as defaultModel', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-same-fallback';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
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
        payload: { defaultModel: LlmModels.GPT4oMini, fallbackModel: LlmModels.GPT4oMini },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('different from the default model');
    });

    it('rejects fallbackModel when no API key for its provider', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-fallback-no-key';
      const missingProviderFallback = LlmModels.ClaudeHaiku35;
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from('test-key').toString('base64') },
          // No anthropic key
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
        payload: { defaultModel: LlmModels.GPT4oMini, fallbackModel: missingProviderFallback },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('no API key configured');
      expect(body.error.message).toContain('anthropic');
    });
  });

  describe('PATCH /users/:uid/settings/transcription', () => {
    it('returns 200 and saves transcription provider', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-transcription';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/transcription`,
        headers: { authorization: `Bearer ${token}` },
        payload: { provider: 'speechmatics' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { provider: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('speechmatics');

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.transcriptionPreferences?.provider).toBe('speechmatics');
    });

    it('returns 400 for invalid provider', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-bad-provider';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/transcription`,
        headers: { authorization: `Bearer ${token}` },
        payload: { provider: 'invalid-provider' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 for missing provider', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-missing-provider';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/transcription`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without auth token', { timeout: 20000 }, async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/some-user/settings/transcription',
        payload: { provider: 'speechmatics' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when updating a different user', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-a';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent('auth0|user-b')}/settings/transcription`,
        headers: { authorization: `Bearer ${token}` },
        payload: { provider: 'speechmatics' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 500 when repository fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextUpdateTranscriptionPreferences(true);

      app = await buildServer();

      const userId = 'auth0|user-repo-fail-transcription';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/transcription`,
        headers: { authorization: `Bearer ${token}` },
        payload: { provider: 'speechmatics' },
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

  describe('PATCH /users/:uid/settings/timezone', () => {
    it('returns 200 and saves valid timezone', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-timezone';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/timezone`,
        headers: { authorization: `Bearer ${token}` },
        payload: { timezone: 'Europe/Berlin' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { timezone: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.timezone).toBe('Europe/Berlin');

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.timezone).toBe('Europe/Berlin');
    });

    it('returns 400 for invalid timezone', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-bad-timezone';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/timezone`,
        headers: { authorization: `Bearer ${token}` },
        payload: { timezone: 'Not/A/Timezone' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toContain('Not/A/Timezone');
    });

    it('returns 400 for missing timezone', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-missing-timezone';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/timezone`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without auth token', { timeout: 20000 }, async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/some-user/settings/timezone',
        payload: { timezone: 'Europe/Berlin' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when updating a different user', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-a';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent('auth0|user-b')}/settings/timezone`,
        headers: { authorization: `Bearer ${token}` },
        payload: { timezone: 'Europe/Berlin' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 500 when repository fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextUpdateTimezone(true);

      app = await buildServer();

      const userId = 'auth0|user-repo-fail-timezone';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/timezone`,
        headers: { authorization: `Bearer ${token}` },
        payload: { timezone: 'America/New_York' },
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

  describe('GET /users/:uid/settings includes timezone', () => {
    it('returns timezone in settings when present', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-with-tz';
      fakeSettingsRepo.setSettings({
        userId,
        timezone: 'America/Chicago',
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
          timezone?: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.timezone).toBe('America/Chicago');
    });
  });
});
