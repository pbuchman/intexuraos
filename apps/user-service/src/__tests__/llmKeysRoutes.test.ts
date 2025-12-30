/**
 * Tests for LLM API Keys routes:
 * - GET /users/:uid/settings/llm-keys
 * - PATCH /users/:uid/settings/llm-keys
 * - DELETE /users/:uid/settings/llm-keys/:provider
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import {
  FakeAuthTokenRepository,
  FakeUserSettingsRepository,
  FakeEncryptor,
  FakeLlmValidator,
} from './fakes.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = 'test-client-id';
const AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('LLM Keys Routes', () => {
  let app: FastifyInstance;
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;
  const issuer = `https://${AUTH0_DOMAIN}/`;

  let fakeAuthTokenRepo: FakeAuthTokenRepository;
  let fakeSettingsRepo: FakeUserSettingsRepository;
  let fakeEncryptor: FakeEncryptor;
  let fakeLlmValidator: FakeLlmValidator;

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
    process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
    process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
    process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
    process.env['AUTH_JWKS_URL'] = jwksUrl;
    process.env['AUTH_ISSUER'] = issuer;

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
    });
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('GET /users/:uid/settings/llm-keys', () => {
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

    it('returns null for all providers when no keys configured', { timeout: 20000 }, async () => {
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
        data: { google: string | null; openai: string | null; anthropic: string | null };
      };
      expect(body.success).toBe(true);
      expect(body.data.google).toBeNull();
      expect(body.data.openai).toBeNull();
      expect(body.data.anthropic).toBeNull();
    });

    it('returns masked keys for configured providers', { timeout: 20000 }, async () => {
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
        data: { google: string | null; openai: string | null; anthropic: string | null };
      };
      expect(body.success).toBe(true);
      // Now returns masked keys like "AIza...ghij" instead of 'configured'
      expect(body.data.google).toBe('AIza...ghij');
      expect(body.data.openai).toBeNull();
      expect(body.data.anthropic).toBe('sk-a...abcd');
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

    it('returns null when decryption fails', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-decrypt-fail';
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
        data: { google: string | null; openai: string | null; anthropic: string | null };
      };
      expect(body.success).toBe(true);
      // Returns null when decryption fails
      expect(body.data.google).toBeNull();
    });
  });

  describe('PATCH /users/:uid/settings/llm-keys', () => {
    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'PATCH',
        url: '/users/user-123/settings/llm-keys',
        payload: {
          provider: 'google',
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
          provider: 'google',
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

    it('stores encrypted key and returns masked value', { timeout: 20000 }, async () => {
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
          provider: 'google',
          apiKey: 'AIzaSyB1234567890abcdef',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { provider: string; masked: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.provider).toBe('google');
      expect(body.data.masked).toBe('AIza...cdef');

      // Verify key was stored
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmApiKeys?.google).toBeDefined();
    });

    it('returns 503 when encryption not configured', { timeout: 20000 }, async () => {
      // Set encryptor to null
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        auth0Client: null,
        encryptor: null,
        llmValidator: null,
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
          provider: 'google',
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
          provider: 'openai',
          apiKey: 'sk-test1234567890abcdef',
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
          provider: 'anthropic',
          apiKey: 'sk-ant-test1234567890',
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
          provider: 'openai',
          apiKey: 'sk-invalid1234567890',
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
          provider: 'google',
          apiKey: 'short',
        },
      });

      expect(response.statusCode).toBe(400);
    });

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
        url: '/users/user-123/settings/llm-keys/google',
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
        url: '/users/auth0|other-user/settings/llm-keys/google',
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

    it('deletes key successfully', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-delete-key';
      const googleKey = 'AIzaSyB1234567890abcdefghij';
      const openaiKey = 'sk-proj1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          google: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(googleKey).toString('base64') },
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(openaiKey).toString('base64') },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean };
      expect(body.success).toBe(true);

      // Verify key was deleted
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmApiKeys?.google).toBeUndefined();
      expect(stored?.llmApiKeys?.openai).toBeDefined();
    });

    it('returns 500 when repository delete fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextDeleteLlmKey(true);

      app = await buildServer();

      const userId = 'auth0|user-delete-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'DELETE',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openai`,
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

  describe('API Key Validation (non-test environment)', () => {
    const originalNodeEnv = process.env['NODE_ENV'];

    beforeEach(() => {
      // Set to non-test environment to enable validation
      process.env['NODE_ENV'] = 'development';
    });

    afterEach(() => {
      // Restore original NODE_ENV
      process.env['NODE_ENV'] = originalNodeEnv;
      vi.resetAllMocks();
    });

    it('validates Google API key successfully', { timeout: 20000 }, async () => {
      const { createGeminiClient } = await import('@intexuraos/infra-gemini');
      const mockValidateKey = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(createGeminiClient).mockReturnValue({
        validateKey: mockValidateKey,
      } as ReturnType<typeof createGeminiClient>);

      app = await buildServer();

      const userId = 'auth0|user-google-valid';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'google',
          apiKey: 'AIzaSyB1234567890abcdef',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockValidateKey).toHaveBeenCalled();
    });

    it('returns 400 when Google API key is invalid', { timeout: 20000 }, async () => {
      const { createGeminiClient } = await import('@intexuraos/infra-gemini');
      vi.mocked(createGeminiClient).mockReturnValue({
        validateKey: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'INVALID_KEY', message: 'Invalid key' },
        }),
      } as unknown as ReturnType<typeof createGeminiClient>);

      app = await buildServer();

      const userId = 'auth0|user-google-invalid';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'google',
          apiKey: 'invalid-google-key-1234',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('Invalid Google API key');
    });

    it('returns 400 when Google API returns other error', { timeout: 20000 }, async () => {
      const { createGeminiClient } = await import('@intexuraos/infra-gemini');
      vi.mocked(createGeminiClient).mockReturnValue({
        validateKey: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'OTHER_ERROR', message: 'Rate limited' },
        }),
      } as unknown as ReturnType<typeof createGeminiClient>);

      app = await buildServer();

      const userId = 'auth0|user-google-other-error';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'google',
          apiKey: 'some-google-key-12345',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.message).toBe('Google API error: Rate limited');
    });

    it('validates OpenAI API key successfully', { timeout: 20000 }, async () => {
      const { createGptClient } = await import('@intexuraos/infra-gpt');
      const mockValidateKey = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(createGptClient).mockReturnValue({
        validateKey: mockValidateKey,
      } as ReturnType<typeof createGptClient>);

      app = await buildServer();

      const userId = 'auth0|user-openai-valid';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'openai',
          apiKey: 'sk-proj1234567890abcdef',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockValidateKey).toHaveBeenCalled();
    });

    it('returns 400 when OpenAI API key is invalid', { timeout: 20000 }, async () => {
      const { createGptClient } = await import('@intexuraos/infra-gpt');
      vi.mocked(createGptClient).mockReturnValue({
        validateKey: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'INVALID_KEY', message: 'Invalid key' },
        }),
      } as unknown as ReturnType<typeof createGptClient>);

      app = await buildServer();

      const userId = 'auth0|user-openai-invalid';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'openai',
          apiKey: 'sk-invalid-key-123456',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.message).toBe('Invalid OpenAI API key');
    });

    it('returns 400 when OpenAI API returns other error', { timeout: 20000 }, async () => {
      const { createGptClient } = await import('@intexuraos/infra-gpt');
      vi.mocked(createGptClient).mockReturnValue({
        validateKey: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'API_ERROR', message: 'Service unavailable' },
        }),
      } as unknown as ReturnType<typeof createGptClient>);

      app = await buildServer();

      const userId = 'auth0|user-openai-other-error';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'openai',
          apiKey: 'sk-some-openai-key-1234',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.message).toBe('OpenAI API error: Service unavailable');
    });

    it('validates Anthropic API key successfully', { timeout: 20000 }, async () => {
      const { createClaudeClient } = await import('@intexuraos/infra-claude');
      const mockValidateKey = vi.fn().mockResolvedValue({ ok: true });
      vi.mocked(createClaudeClient).mockReturnValue({
        validateKey: mockValidateKey,
      } as ReturnType<typeof createClaudeClient>);

      app = await buildServer();

      const userId = 'auth0|user-anthropic-valid';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'anthropic',
          apiKey: 'sk-ant-api1234567890',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockValidateKey).toHaveBeenCalled();
    });

    it('returns 400 when Anthropic API key is invalid', { timeout: 20000 }, async () => {
      const { createClaudeClient } = await import('@intexuraos/infra-claude');
      vi.mocked(createClaudeClient).mockReturnValue({
        validateKey: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'INVALID_KEY', message: 'Invalid key' },
        }),
      } as unknown as ReturnType<typeof createClaudeClient>);

      app = await buildServer();

      const userId = 'auth0|user-anthropic-invalid';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'anthropic',
          apiKey: 'sk-ant-invalid-12345',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.message).toBe('Invalid Anthropic API key');
    });

    it('returns 400 when Anthropic API returns other error', { timeout: 20000 }, async () => {
      const { createClaudeClient } = await import('@intexuraos/infra-claude');
      vi.mocked(createClaudeClient).mockReturnValue({
        validateKey: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'QUOTA_EXCEEDED', message: 'Quota exceeded' },
        }),
      } as unknown as ReturnType<typeof createClaudeClient>);

      app = await buildServer();

      const userId = 'auth0|user-anthropic-other-error';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'PATCH',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          provider: 'anthropic',
          apiKey: 'sk-ant-some-key-123456',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.error.message).toBe('Anthropic API error: Quota exceeded');
    });
  });

  describe('POST /users/:uid/settings/llm-keys/:provider/test', () => {
    it('returns 401 when no auth token', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/users/user-123/settings/llm-keys/google/test',
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
        url: '/users/auth0|other-user/settings/llm-keys/google/test',
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

    it('returns 404 when API key not configured', { timeout: 20000 }, async () => {
      app = await buildServer();

      const userId = 'auth0|user-no-key-test';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
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

      // Set encryptor to null
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        auth0Client: null,
        encryptor: null,
        llmValidator: null,
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
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

      // Set llmValidator to null but keep encryptor
      setServices({
        authTokenRepository: fakeAuthTokenRepo,
        userSettingsRepository: fakeSettingsRepo,
        auth0Client: null,
        encryptor: fakeEncryptor,
        llmValidator: null,
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
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

      fakeEncryptor.setFailNextDecrypt(true);

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
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

      fakeLlmValidator.setTestResponse('Hello! I am Gemini Pro.');

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { response: string; testedAt: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.response).toBe('Hello! I am Gemini Pro.');
      expect(body.data.testedAt).toBeDefined();

      // Verify test result was saved
      const stored = fakeSettingsRepo.getStoredSettings(userId);
      expect(stored?.llmTestResults?.google).toBeDefined();
      expect(stored?.llmTestResults?.google?.response).toBe('Hello! I am Gemini Pro.');
    });

    it('returns 502 when test request fails', { timeout: 20000 }, async () => {
      const userId = 'auth0|user-test-fail';
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

      fakeLlmValidator.setFailNextTest(true);

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('tests Google API key successfully', { timeout: 20000 }, async () => {
      const { createGeminiClient } = await import('@intexuraos/infra-gemini');
      vi.mocked(createGeminiClient).mockReturnValue({
        research: vi.fn().mockResolvedValue({
          ok: true,
          value: { content: 'Hello! Your API key is working correctly.' },
        }),
      } as unknown as ReturnType<typeof createGeminiClient>);

      const userId = 'auth0|user-test-google-success';
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

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { response: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.response).toBe('Hello! Your API key is working correctly.');
    });

    it('returns 502 when Google test request fails', { timeout: 20000 }, async () => {
      const { createGeminiClient } = await import('@intexuraos/infra-gemini');
      vi.mocked(createGeminiClient).mockReturnValue({
        research: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'API_ERROR', message: 'Service unavailable' },
        }),
      } as unknown as ReturnType<typeof createGeminiClient>);

      const userId = 'auth0|user-test-google-fail';
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

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('tests OpenAI API key successfully', { timeout: 20000 }, async () => {
      const { createGptClient } = await import('@intexuraos/infra-gpt');
      vi.mocked(createGptClient).mockReturnValue({
        research: vi.fn().mockResolvedValue({
          ok: true,
          value: { content: 'Hello! Your API key is working correctly.' },
        }),
      } as unknown as ReturnType<typeof createGptClient>);

      const userId = 'auth0|user-test-openai-success';
      const openaiKey = 'sk-proj1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(openaiKey).toString('base64') },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openai/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { response: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.response).toBe('Hello! Your API key is working correctly.');
    });

    it('returns 502 when OpenAI test request fails', { timeout: 20000 }, async () => {
      const { createGptClient } = await import('@intexuraos/infra-gpt');
      vi.mocked(createGptClient).mockReturnValue({
        research: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'RATE_LIMITED', message: 'Rate limited' },
        }),
      } as unknown as ReturnType<typeof createGptClient>);

      const userId = 'auth0|user-test-openai-fail';
      const openaiKey = 'sk-proj1234567890abcdefgh';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
          openai: { iv: 'iv', tag: 'tag', ciphertext: Buffer.from(openaiKey).toString('base64') },
        },
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      });

      app = await buildServer();

      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/openai/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('tests Anthropic API key successfully', { timeout: 20000 }, async () => {
      const { createClaudeClient } = await import('@intexuraos/infra-claude');
      vi.mocked(createClaudeClient).mockReturnValue({
        research: vi.fn().mockResolvedValue({
          ok: true,
          value: { content: 'Hello! Your API key is working correctly.' },
        }),
      } as unknown as ReturnType<typeof createClaudeClient>);

      const userId = 'auth0|user-test-anthropic-success';
      const anthropicKey = 'sk-ant-api1234567890abcd';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
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
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/anthropic/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { response: string };
      };
      expect(body.success).toBe(true);
      expect(body.data.response).toBe('Hello! Your API key is working correctly.');
    });

    it('returns 502 when Anthropic test request fails', { timeout: 20000 }, async () => {
      const { createClaudeClient } = await import('@intexuraos/infra-claude');
      vi.mocked(createClaudeClient).mockReturnValue({
        research: vi.fn().mockResolvedValue({
          ok: false,
          error: { code: 'OVERLOADED', message: 'Service overloaded' },
        }),
      } as unknown as ReturnType<typeof createClaudeClient>);

      const userId = 'auth0|user-test-anthropic-fail';
      const anthropicKey = 'sk-ant-api1234567890abcd';
      fakeSettingsRepo.setSettings({
        userId,
        notifications: { filters: [] },
        llmApiKeys: {
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
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/anthropic/test`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(502);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('DOWNSTREAM_ERROR');
    });

    it('returns 500 when repository fails', { timeout: 20000 }, async () => {
      fakeSettingsRepo.setFailNextGet(true);

      app = await buildServer();

      const userId = 'auth0|user-test-repo-fail';
      const token = await createToken({ sub: userId });

      const response = await app.inject({
        method: 'POST',
        url: `/users/${encodeURIComponent(userId)}/settings/llm-keys/google/test`,
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
