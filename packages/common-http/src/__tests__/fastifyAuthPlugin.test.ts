/**
 * Tests for Fastify auth plugin.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { intexuraFastifyPlugin } from '../http/fastifyPlugin.js';
import { fastifyAuthPlugin, requireAuth, tryAuth } from '../auth/fastifyAuthPlugin.js';
import { verifyJwt } from '../auth/jwt.js';

// Mock the JWT verification module
vi.mock('../auth/jwt.js', () => ({
  verifyJwt: vi.fn(),
  clearJwksCache: vi.fn(),
}));

describe('Fastify Auth Plugin', () => {
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    process.env = originalEnv;
  });

  describe('plugin registration', () => {
    it('configures JWT when all env vars are set', async () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.example.com';

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      expect(app.jwtConfig).toEqual({
        jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
        issuer: 'https://auth.example.com/',
        audience: 'https://api.example.com',
      });
    });

    it('sets jwtConfig to null when env vars are missing', async () => {
      delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
      delete process.env['INTEXURAOS_AUTH_ISSUER'];
      delete process.env['INTEXURAOS_AUTH_AUDIENCE'];

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      expect(app.jwtConfig).toBeNull();
    });

    it('sets jwtConfig to null when env vars are empty strings', async () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = '';
      process.env['INTEXURAOS_AUTH_ISSUER'] = '';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = '';

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      expect(app.jwtConfig).toBeNull();
    });

    it('sets jwtConfig to null when only some env vars are set', async () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
      delete process.env['INTEXURAOS_AUTH_ISSUER'];
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.example.com';

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      expect(app.jwtConfig).toBeNull();
    });
  });

  describe('requireAuth', () => {
    beforeEach(async () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.example.com';

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);
    });

    it('returns user when token is valid', async () => {
      vi.mocked(verifyJwt).mockResolvedValue({
        sub: 'user-123',
        claims: { email: 'user@example.com' },
      });

      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return reply.ok({ userId: user.userId });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.userId).toBe('user-123');
    });

    it('returns null and sends MISCONFIGURED when jwtConfig is null', async () => {
      // Create a new app without auth config
      await app.close();
      delete process.env['INTEXURAOS_AUTH_JWKS_URL'];

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return reply.ok({ userId: user.userId });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer some-token',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('MISCONFIGURED');
    });

    it('returns null and sends UNAUTHORIZED when authorization header is missing', async () => {
      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return reply.ok({ userId: user.userId });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Missing');
    });

    it('returns null and sends UNAUTHORIZED when authorization header is empty', async () => {
      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return reply.ok({ userId: user.userId });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: '',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns null and sends UNAUTHORIZED when Bearer prefix is missing', async () => {
      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return reply.ok({ userId: user.userId });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Basic credentials',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns null and sends UNAUTHORIZED when token verification fails', async () => {
      const error = new Error('Token expired');
      vi.mocked(verifyJwt).mockRejectedValue(error);

      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return reply.ok({ userId: user.userId });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer expired-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toBe('Token expired');
    });

    it('sends generic message when error has no message property', async () => {
      vi.mocked(verifyJwt).mockRejectedValue('string error');

      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return reply.ok({ userId: user.userId });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer bad-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.message).toBe('Authentication failed');
    });

    it('attaches user to request', async () => {
      vi.mocked(verifyJwt).mockResolvedValue({
        sub: 'user-456',
        claims: { role: 'admin' },
      });

      let capturedUser: unknown;
      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        capturedUser = request.user;
        if (user === null) return;
        return reply.ok({ ok: true });
      });

      await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(capturedUser).toEqual({
        userId: 'user-456',
        claims: { role: 'admin' },
      });
    });
  });

  describe('tryAuth', () => {
    beforeEach(async () => {
      process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://auth.example.com/.well-known/jwks.json';
      process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://auth.example.com/';
      process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.example.com';

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);
    });

    it('returns user when token is valid', async () => {
      vi.mocked(verifyJwt).mockResolvedValue({
        sub: 'user-789',
        claims: {},
      });

      let result: unknown;
      app.get('/optional-auth', async (request, reply) => {
        result = await tryAuth(request);
        return reply.ok({ authenticated: result !== null });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/optional-auth',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(result).toEqual({
        userId: 'user-789',
        claims: {},
      });
    });

    it('returns null when jwtConfig is null', async () => {
      await app.close();
      delete process.env['INTEXURAOS_AUTH_JWKS_URL'];

      app = Fastify({ logger: false });
      await app.register(intexuraFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      let result: unknown = 'not-null';
      app.get('/optional-auth', async (request, reply) => {
        result = await tryAuth(request);
        return reply.ok({ authenticated: result !== null });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/optional-auth',
        headers: {
          authorization: 'Bearer some-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(result).toBeNull();
    });

    it('returns null when no authorization header', async () => {
      let result: unknown = 'not-null';
      app.get('/optional-auth', async (request, reply) => {
        result = await tryAuth(request);
        return reply.ok({ authenticated: result !== null });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/optional-auth',
      });

      expect(response.statusCode).toBe(200);
      expect(result).toBeNull();
    });

    it('returns null when token verification fails', async () => {
      vi.mocked(verifyJwt).mockRejectedValue(new Error('Invalid token'));

      let result: unknown = 'not-null';
      app.get('/optional-auth', async (request, reply) => {
        result = await tryAuth(request);
        return reply.ok({ authenticated: result !== null });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/optional-auth',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(result).toBeNull();
    });

    it('attaches user to request when valid', async () => {
      vi.mocked(verifyJwt).mockResolvedValue({
        sub: 'optional-user',
        claims: { scope: 'read' },
      });

      let capturedRequestUser: unknown;
      app.get('/optional-auth', async (request, reply) => {
        await tryAuth(request);
        capturedRequestUser = request.user;
        return reply.ok({ ok: true });
      });

      await app.inject({
        method: 'GET',
        url: '/optional-auth',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(capturedRequestUser).toEqual({
        userId: 'optional-user',
        claims: { scope: 'read' },
      });
    });
  });
});
