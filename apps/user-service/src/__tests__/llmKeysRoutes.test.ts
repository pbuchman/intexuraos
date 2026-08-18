/**
 * Tests for LLM API Keys routes:
 * - GET /users/:uid/settings/llm-keys
 * - PATCH /users/:uid/settings/llm-keys
 * - DELETE /users/:uid/settings/llm-keys/:provider
 */
import {
  DEFAULT_PLATFORM_LLM_MODEL,
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
  FakeEncryptor,
  FakeLlmValidator,
  FakeOAuthConnectionRepository,
  FakeUserSettingsRepository,
} from './fakes.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('LLM Keys Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

  let fakeAuthTokenRepo: FakeAuthTokenRepository;
  let fakeSettingsRepo: FakeUserSettingsRepository;
  let fakeEncryptor: FakeEncryptor;
  let fakeLlmValidator: FakeLlmValidator;

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
    fakeEncryptor = new FakeEncryptor();
    fakeLlmValidator = new FakeLlmValidator();
    setServices({
      authTokenRepository: fakeAuthTokenRepo,
      userSettingsRepository: fakeSettingsRepo,
      auth0Client: null,
      encryptor: fakeEncryptor,
      llmValidator: fakeLlmValidator,
      oauthConnectionRepository: new FakeOAuthConnectionRepository(),
      googleOAuthClient: null,
      gitHubOAuthClient: null,
    });
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /users/:uid/settings/llm-keys', () => {
    it('does not reveal selector availability or read selector state before auth or self ownership', { timeout: 20000 }, async () => {
      const available = vi.fn(async () => false);
      const selectorRead = vi.spyOn(fakeSettingsRepo, 'getIntexAgentModelState');
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: available,
        },
      });
      app = await buildServer();

      const unauthenticated = await app.inject({ method: 'GET', url: '/users/auth0%7Csubject/settings/llm-keys' });
      expect(unauthenticated.statusCode).toBe(401);
      const token = await createToken({ sub: 'auth0|subject' });
      const foreign = await app.inject({
        method: 'GET',
        url: '/users/auth0%7Cforeign/settings/llm-keys',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(foreign.statusCode).toBe(403);
      expect(available).not.toHaveBeenCalled();
      expect(selectorRead).not.toHaveBeenCalled();
    });

    it('strictly reads clean unavailable selector state before returning the closed unavailable arm', { timeout: 20000 }, async () => {
      const userId = 'auth0|unavailable-clean-user';
      const selectorRead = vi.spyOn(fakeSettingsRepo, 'getIntexAgentModelState');
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async () => false,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      expect(selectorRead).toHaveBeenCalledWith(userId);
      expect((JSON.parse(response.body) as { data: { intexAgentModelSelector: unknown } }).data.intexAgentModelSelector).toEqual({
        status: 'unavailable',
      });
    });

    it('projects the exact available Intex Agent selector after self authorization', { timeout: 20000 }, async () => {
      const userId = 'auth0|selector-user';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: {
          intexAgentModel: IntexAgentModels.MiniMaxM3,
          intexAgentModelRevision: 7,
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async (candidate) => candidate === userId,
        },
      });
      app = await buildServer();

      const token = await createToken({ sub: userId });
      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { data: { intexAgentModelSelector: unknown } };
      expect(body.data.intexAgentModelSelector).toEqual({
        status: 'available',
        explicitModel: IntexAgentModels.MiniMaxM3,
        effectiveModel: IntexAgentModels.MiniMaxM3,
        source: 'explicit',
        revision: 7,
        options: [
          { id: IntexAgentModels.DeepSeekV4Flash, label: 'DeepSeek V4 Flash' },
          { id: IntexAgentModels.MiniMaxM3, label: 'MiniMax M3' },
          { id: IntexAgentModels.Gemini36Flash, label: 'Gemini 3.6 Flash' },
        ],
      });
    });

    it('returns a static selector-state error before unavailable projection for corrupt stored selector state', { timeout: 20000 }, async () => {
      const userId = 'auth0|corrupt-selector-user';
      fakeSettingsRepo.setRawIntexAgentModelState(userId, { intexAgentModel: 'forged' });
      app = await buildServer();

      const token = await createToken({ sub: userId });
      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { error: { code: string; message: string } };
      expect(body.error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Intex Agent model selector state is invalid',
      });
    });

    it.each([
      [{}, IntexAgentModels.DeepSeekV4Flash, 'default_absent', 0],
      [{ intexAgentModel: IntexAgentModels.DeepSeekV4Flash, intexAgentModelRevision: 2 }, IntexAgentModels.DeepSeekV4Flash, 'explicit', 2],
      [{ intexAgentModel: IntexAgentModels.Gemini36Flash, intexAgentModelRevision: 3 }, IntexAgentModels.Gemini36Flash, 'explicit', 3],
    ])('projects exact available effective selector state %#', async (preferences, effectiveModel, source, revision) => {
      const userId = `auth0|selector-state-${String(revision)}`;
      fakeSettingsRepo.setRawIntexAgentModelState(userId, preferences);
      setServices({
        intexAgentModelAvailability: {
          start: () => Promise.resolve(),
          isAvailableForUser: async () => true,
        },
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const selector = (JSON.parse(response.body) as { data: { intexAgentModelSelector: Record<string, unknown> } }).data.intexAgentModelSelector;
      expect(selector).toMatchObject({ status: 'available', effectiveModel, source, revision });
    });

    it.each([{ intexAgentModel: 'forged' }, { intexAgentModelRevision: -1 }, [] as unknown])(
      'returns the same static corrupt selector error for available and unavailable reads: %j',
      async (rawPreferences) => {
        for (const available of [false, true]) {
          const userId = `auth0|corrupt-${String(available)}-${JSON.stringify(rawPreferences)}`;
          fakeSettingsRepo.setRawIntexAgentModelState(userId, rawPreferences);
          setServices({
            intexAgentModelAvailability: {
              start: () => Promise.resolve(),
              isAvailableForUser: async () => available,
            },
          });
          app = await buildServer();
          const token = await createToken({ sub: userId });
          const response = await app.inject({
            method: 'GET',
            url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
            headers: { authorization: `Bearer ${token}` },
          });
          expect(response.statusCode).toBe(500);
          expect((JSON.parse(response.body) as { error: unknown }).error).toEqual({
            code: 'INTERNAL_ERROR',
            message: 'Intex Agent model selector state is invalid',
          });
          await app.close();
        }
      }
    );

    it('maps selector repository failures to a static public error', { timeout: 20000 }, async () => {
      const userId = 'auth0|selector-read-failure';
      fakeSettingsRepo.setFailNextGetIntexAgentModelState(true);
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(500);
      expect((JSON.parse(response.body) as { error: unknown }).error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Failed to load Intex Agent model selector',
      });
    });

    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/users/user-123/settings/llm-keys',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when accessing another user keys', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-123',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/users/auth0|other-user/settings/llm-keys',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns unavailable OpenRouter access when no key is configured', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-no-keys';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          accessSource: string;
          openrouter: string | null;
          defaultModel: string | null;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data).not.toHaveProperty('google');
      expect(body.data).not.toHaveProperty('openai');
      expect(body.data).not.toHaveProperty('anthropic');
      expect(body.data.accessSource).toBe('unavailable');
      expect(body.data.openrouter).toBeNull();
      expect(body.data.defaultModel).toBeNull();
    });

    it('returns only OpenRouter settings and reports unavailable access', { timeout: 20000 }, async () => {
      app = await buildServer();
      const userId = 'auth0|openrouter-unavailable';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = (JSON.parse(response.body) as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({
        accessSource: 'unavailable',
        openrouter: null,
        testResults: { openrouter: null },
      });
      expect(data).not.toHaveProperty('openai');
      expect(data).not.toHaveProperty('anthropic');
      expect(data).not.toHaveProperty('perplexity');
    });

    it('reports platform access without exposing the platform key', { timeout: 20000 }, async () => {
      setServices({ platformOpenRouterApiKeyAvailable: true });
      app = await buildServer();
      const userId = 'auth0|openrouter-platform';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = (JSON.parse(response.body) as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({ accessSource: 'platform', openrouter: null });
    });

    it('reports user access for a decryptable BYOK', { timeout: 20000 }, async () => {
      setServices({ platformOpenRouterApiKeyAvailable: true });
      const userId = 'auth0|openrouter-user';
      const apiKey = 'sk-or-1234567890abcdef';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(apiKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = (JSON.parse(response.body) as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({ accessSource: 'user', openrouter: 'sk-o...cdef' });
    });

    it('treats a blank decrypted BYOK as absent and reports platform access', { timeout: 20000 }, async () => {
      setServices({ platformOpenRouterApiKeyAvailable: true });
      const userId = 'auth0|openrouter-blank-user-key';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from('   ').toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = (JSON.parse(response.body) as { data: Record<string, unknown> }).data;
      expect(data).toMatchObject({ accessSource: 'platform', openrouter: null });
    });

    it('normalizes a stored legacy Google defaultModel to the platform model', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-with-pref';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { defaultModel: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.defaultModel).toBe(DEFAULT_PLATFORM_LLM_MODEL);
    });

    it('normalizes direct-provider preferences on read without writeback', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-with-direct-pref';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: {
          defaultModel: LlmModels.GPT4oMini,
          fallbackModel: LlmModels.ClaudeHaiku35,
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = (JSON.parse(response.body) as {
        data: { defaultModel: string; fallbackModel: string };
      }).data;
      expect(data).toEqual(
        expect.objectContaining({
          defaultModel: DEFAULT_PLATFORM_LLM_MODEL,
          fallbackModel: DEFAULT_PLATFORM_LLM_MODEL,
        })
      );
      expect(fakeSettingsRepo.getStoredSettings(userId)?.llmPreferences).toEqual({
        defaultModel: LlmModels.GPT4oMini,
        fallbackModel: LlmModels.ClaudeHaiku35,
      });
    });

    it('returns fallbackModel in GET response when set', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-with-fallback';
      const orFallback = 'or:google/gemma-4-31b-it:free';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash, fallbackModel: orFallback },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { defaultModel: string | null; fallbackModel: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.defaultModel).toBe(DEFAULT_PLATFORM_LLM_MODEL);
      expect(body.data.fallbackModel).toBe(orFallback);
    });

    it('returns null fallbackModel when not set', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-no-fallback';
      fakeSettingsRepo.setSettings({
        userId,
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { fallbackModel: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.fallbackModel).toBeNull();
    });

    it('does not expose configured legacy direct-provider keys', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-with-keys';
      // Use base64-encoded API keys that FakeEncryptor can decode
      const googleKey = 'AIzaSyB1234567890abcdefghij'; // 28 chars
      const anthropicKey = 'sk-ant-api1234567890abcd'; // 25 chars
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

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: Record<string, unknown>;
      };
      expect(body.success).toBe(true);
      expect(body.data).not.toHaveProperty('google');
      expect(body.data).not.toHaveProperty('openai');
      expect(body.data).not.toHaveProperty('anthropic');
      expect(body.data).toMatchObject({ accessSource: 'unavailable', openrouter: null });
    });

    it('returns 500 when repository fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const userId = 'auth0|user-error';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
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

    it('catches unexpected exceptions and returns 500', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setThrowOnGet(true);

      app = await buildServer();

      const userId = 'auth0|user-unexpected-error';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('Failed to get LLM keys');
    });

    it('reports unavailable access when OpenRouter BYOK decryption fails', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-decrypt-fail';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      // Make decryption fail
      fakeEncryptor.setFailNextDecrypt(true);

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'GET',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { accessSource: string; openrouter: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data).not.toHaveProperty('google');
      expect(body.data.accessSource).toBe('unavailable');
      expect(body.data.openrouter).toBeNull();
    });
  });

  describe('PATCH /users/:uid/settings/llm-keys', () => {
    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/user-123/settings/llm-keys',
        payload: {
          provider: LlmProviders.OpenRouter,
          apiKey: 'test-api-key-12345',
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

    it('returns 403 when updating another user keys', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-123',
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/auth0|other-user/settings/llm-keys',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: LlmProviders.OpenRouter,
          apiKey: 'test-api-key-12345',
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('stores an executable provider key and returns its masked value', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-set-key';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: LlmProviders.OpenRouter,
          apiKey: 'sk-or-1234567890abcdef',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { provider: string; masked: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe(LlmProviders.OpenRouter);
      expect(body.data.masked).toBe('sk-o...cdef');

      // Verify key was stored
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmApiKeys?.openrouter).toBeDefined();
    });

    it('returns 503 when encryption not configured', { timeout: 20000 }, async () => {
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

      app = await buildServer();

      const userId = 'auth0|user-no-encrypt';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: LlmProviders.OpenRouter,
          apiKey: 'test-api-key-12345',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns 500 when encryption fails', { timeout: 20000 }, async () => {
      fakeEncryptor.setFailNextEncrypt(true);

      app = await buildServer();

      const userId = 'auth0|user-encrypt-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: LlmProviders.OpenRouter,
          apiKey: 'sk-or-test1234567890abcdef',
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

    it('returns 500 when repository update fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextUpdateLlmKey(true);

      app = await buildServer();

      const userId = 'auth0|user-update-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: LlmProviders.OpenRouter,
          apiKey: 'sk-or-test1234567890',
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

    it('returns 400 when API key validation fails', { timeout: 20000 }, async () => {
      fakeLlmValidator.setFailNextValidation(true, {
        code: 'INVALID_KEY',
        message: 'Invalid API key provided',
      });

      app = await buildServer();

      const userId = 'auth0|user-validation-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: LlmProviders.OpenRouter,
          apiKey: 'sk-or-invalid1234567890',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Invalid API key provided');
    });

    it('returns 400 when apiKey is too short', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-short-key';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: LlmProviders.OpenAI,
          apiKey: 'short',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when attempting to store a legacy Google key', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-google-key-rejected';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          provider: LlmProviders.Google,
          apiKey: 'AIzaSyB1234567890abcdef',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(fakeSettingsRepo.getStoredSettings(userId)?.llmApiKeys?.google).toBeUndefined();
    });

    it.each([LlmProviders.OpenAI, LlmProviders.Anthropic, LlmProviders.Perplexity])(
      'returns 400 when attempting to store a direct-provider %s key',
      async (provider) => {
        app = await buildServer();
        const userId = `auth0|direct-key-${provider}`;
        const token = await createToken({ sub: userId });

        const response = await app.inject({
          method: 'PATCH',
          url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
          headers: { authorization: `Bearer ${token}` },
          payload: { provider, apiKey: 'direct-api-key-12345' },
        });

        expect(response.statusCode).toBe(400);
      }
    );

    it('returns 400 when provider is invalid', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-invalid-provider';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'invalid-provider',
          apiKey: 'test-api-key-12345',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /users/:uid/settings/llm-keys/:provider', () => {
    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'DELETE',
        url: '/users/user-123/settings/llm-keys/openrouter',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when deleting another user keys', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-123',
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/users/auth0|other-user/settings/llm-keys/openrouter',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('deletes only OpenRouter BYOK and test state while preserving preferences', { timeout: 20000 }, async () => {
      const userId = 'auth0|delete-openrouter-only';
      const apiKey = 'sk-or-1234567890abcdef';
      const defaultModel = IntexAgentModels.MiniMaxM3;
      const fallbackModel = 'or:google/gemma-4-31b-it:free';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(apiKey).toString('base64'),
          },
        },
        llmTestResults: {
          openrouter: {
            status: 'success',
            message: 'ok',
            testedAt: '2026-08-18T00:00:00.000Z',
          },
        },
        llmPreferences: { defaultModel, fallbackModel },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });
      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmApiKeys?.openrouter).toBeUndefined();
      expect(stored?.llmTestResults?.openrouter).toBeUndefined();
      expect(stored?.llmPreferences).toEqual({ defaultModel, fallbackModel });
    });

    it.each([
      LlmProviders.Google,
      LlmProviders.OpenAI,
      LlmProviders.Anthropic,
      LlmProviders.Perplexity,
    ])('returns 400 when deleting non-OpenRouter provider %s', async (provider) => {
      app = await buildServer();
      const userId = `auth0|delete-direct-${provider}`;
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/${provider}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('deletes key successfully', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-delete-key';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      const openaiKey = 'sk-proj1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(openaiKey).toString('base64') },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify key was deleted
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmApiKeys?.openrouter).toBeUndefined();
      expect(stored?.llmApiKeys?.openai).toBeDefined();
    });

    it('preserves a legacy default model when deleting OpenRouter BYOK', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-cascade-clear';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences).toEqual({
        defaultModel: LegacyGoogleModels.Gemini25Flash,
      });
    });

    it('preserves an OpenRouter fallback when deleting OpenRouter BYOK', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-cascade-fallback';
      const googleKey = 'AIzaSyB1234567890abcdefghij';
      const orKey = 'or-api-key-1234567890abc';
      const orFallback = 'or:google/gemma-4-31b-it:free';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(googleKey).toString('base64') },
          openrouter: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(orKey).toString('base64') },
        },
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash, fallbackModel: orFallback },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.defaultModel).toBe(LegacyGoogleModels.Gemini25Flash);
      expect(stored?.llmPreferences?.fallbackModel).toBe(orFallback);
    });

    it('does not update preferences after deleting OpenRouter BYOK', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-cascade-fallback-fail';
      const googleKey = 'AIzaSyB1234567890abcdefghij';
      const orKey = 'sk-or-1234567890abcdef1234';
      const orFallback = 'or:google/gemma-4-31b-it:free';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(googleKey).toString('base64') },
          openrouter: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(orKey).toString('base64') },
        },
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash, fallbackModel: orFallback },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      // A pending preference-update failure must remain untouched because DELETE no longer cascades.
      fakeSettingsRepo.setFailNextUpdateLlmPreferences(true);

      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it('preserves a direct-provider historical preference when deleting OpenRouter BYOK', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-cascade-preserve';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        llmPreferences: { defaultModel: LlmModels.GPT4oMini },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.defaultModel).toBe(LlmModels.GPT4oMini);
    });

    it('preserves the entire preference pair when deleting OpenRouter BYOK', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-cascade-keep-fallback';
      const googleKey = 'AIzaSyB1234567890abcdefghij';
      const openaiKey = 'sk-proj1234567890abcdefgh';
      const orKey = 'sk-or-1234567890abcdef1234';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(googleKey).toString('base64') },
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(openaiKey).toString('base64') },
          openrouter: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(orKey).toString('base64') },
        },
        llmPreferences: {
          defaultModel: LegacyGoogleModels.Gemini25Flash,
          fallbackModel: 'or:google/gemma-4-31b-it:free',
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);

      // Both default and fallback should be preserved
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmPreferences?.defaultModel).toBe(LegacyGoogleModels.Gemini25Flash);
      expect(stored?.llmPreferences?.fallbackModel).toBe('or:google/gemma-4-31b-it:free');
    });

    it('does not read settings after deleting OpenRouter BYOK', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-cascade-get-fail';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      // DELETE must not read preferences after removing the key.
      fakeSettingsRepo.setFailNextGet(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('does not clear preferences after deleting OpenRouter BYOK', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-cascade-clear-fail';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        llmPreferences: { defaultModel: LegacyGoogleModels.Gemini25Flash },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      // The obsolete preference-clear path must not be called.
      fakeSettingsRepo.setFailNextClearLlmPreferences(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);
    });

    it('returns 500 when repository delete fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextDeleteLlmKey(true);

      app = await buildServer();

      const userId = 'auth0|user-delete-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter`,
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

  describe('POST /users/:uid/settings/llm-keys/:provider/test', () => {
    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/users/user-123/settings/llm-keys/openrouter/test',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 when testing another user keys', { timeout: 20000 }, async () => {
      app = await buildServer();

      const token = await createToken({
        sub: 'auth0|user-123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/users/auth0|other-user/settings/llm-keys/openrouter/test',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('returns 400 for the legacy Google provider', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-google-test-rejected';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
      expect(fakeSettingsRepo.getStoredSettings(userId)?.llmTestResults?.google).toBeUndefined();
    });

    it.each([LlmProviders.OpenAI, LlmProviders.Anthropic, LlmProviders.Perplexity])(
      'returns 400 when testing a direct-provider %s key',
      async (provider) => {
        app = await buildServer();
        const userId = `auth0|test-direct-${provider}`;
        const token = await createToken({ sub: userId });

        const response = await app.inject({
          method: 'POST',
          url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/${provider}/test`,
          headers: { authorization: `Bearer ${token}` },
        });

        expect(response.statusCode).toBe(400);
      }
    );

    it('returns 404 when API key not configured', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-no-key-test';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 503 when encryption not configured', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-test-no-encrypt';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

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

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns 503 when LLM validator not configured', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-test-no-validator';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        auth0Client: null,
        encryptor: fakeEncryptor,
        llmValidator: null,
        oauthConnectionRepository: new FakeOAuthConnectionRepository(),
        googleOAuthClient: null,
        gitHubOAuthClient: null,
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
      expect(body.error.message).toContain('LLM validation');
    });

    it('returns 500 when decryption fails', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-test-decrypt-fail';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      fakeEncryptor.setFailNextDecrypt(true);

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
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

    it('returns test response on success', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-test-success';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      fakeLlmValidator.setTestResponse('Hello from OpenRouter.');

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { status: string; message: string; testedAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('success');
      expect(body.data.message).toBe('Hello from OpenRouter.');
      expect(body.data.testedAt).toBeDefined();

      // Verify test result was saved
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmTestResults?.openrouter).toBeDefined();
      expect(stored?.llmTestResults?.openrouter?.status).toBe('success');
      expect(stored?.llmTestResults?.openrouter?.message).toBe('Hello from OpenRouter.');
    });

    it('returns 200 with failure status and stores error when test request fails', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-test-fail';
      const openRouterKey = 'sk-or-1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      fakeLlmValidator.setFailNextTest(true);

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { status: string; message: string; testedAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('failure');
      expect(body.data.message).toBe('Test request failed');
      expect(body.data.testedAt).toBeDefined();

      // Verify error was stored for persistence across page refresh
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmTestResults?.openrouter).toBeDefined();
      expect(stored?.llmTestResults?.openrouter?.status).toBe('failure');
      expect(stored?.llmTestResults?.openrouter?.message).toBe('Test request failed');
    });

    it('returns another OpenRouter test response', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-test-openrouter-again';
      const openRouterKey = 'sk-or-api1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openrouter: {
            iv: 'iv',
            tag: 'tag',
            ciphertext: Buffer.from(openRouterKey).toString('base64'),
          },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      fakeLlmValidator.setTestResponse('Hello again from OpenRouter.');

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { status: string; message: string; testedAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('success');
      expect(body.data.message).toBe('Hello again from OpenRouter.');
    });

    it('returns 500 when repository fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const userId = 'auth0|user-test-repo-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openrouter/test`,
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
});
