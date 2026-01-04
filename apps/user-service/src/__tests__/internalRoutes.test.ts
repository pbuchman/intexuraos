/**
 * Tests for internal routes (service-to-service communication):
 * - GET /internal/users/:uid/llm-keys
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { FakeAuthTokenRepository, FakeEncryptor, FakeUserSettingsRepository } from './fakes.js';

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
    setServices({
      authTokenRepository: fakeAuthTokenRepo,
      userSettingsRepository: fakeSettingsRepo,
      auth0Client: null,
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
});
