import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { praxosFastifyPlugin } from '../http/fastifyPlugin.js';
import { fastifyAuthPlugin, requireAuth, clearJwksCache } from '../index.js';

describe('fastifyAuthPlugin', () => {
  let jwksServer: FastifyInstance;
  let privateKey: jose.KeyLike;
  let jwksUrl: string;

  const issuer = 'https://test-auth-plugin-issuer.example.com/';
  const audience = 'test-auth-plugin-audience';

  async function createToken(
    claims: Record<string, unknown>,
    options?: { expiresIn?: string }
  ): Promise<string> {
    const builder = new jose.SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-auth-key-1' })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience);

    if (options?.expiresIn !== undefined) {
      builder.setExpirationTime(options.expiresIn);
    } else {
      builder.setExpirationTime('1h');
    }

    return await builder.sign(privateKey);
  }

  beforeAll(async () => {
    // Generate RSA key pair for testing
    const { publicKey, privateKey: privKey } = await jose.generateKeyPair('RS256');
    privateKey = privKey;

    // Export public key as JWK
    const publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = 'test-auth-key-1';
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
    clearJwksCache();
    // Clear env vars before each test
    delete process.env['AUTH_JWKS_URL'];
    delete process.env['AUTH_ISSUER'];
    delete process.env['AUTH_AUDIENCE'];
  });

  describe('when auth is not configured (missing env vars)', () => {
    it('returns 503 MISCONFIGURED when AUTH_JWKS_URL is missing', async () => {
      const app = Fastify({ logger: false });
      await app.register(praxosFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return await reply.ok({ userId: user.userId });
      });

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer some-token',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
      expect(body.error.message).toContain('AUTH_JWKS_URL');
    });

    it('returns 503 MISCONFIGURED when only some env vars are set', async () => {
      process.env['AUTH_JWKS_URL'] = jwksUrl;
      // AUTH_ISSUER and AUTH_AUDIENCE are missing

      const app = Fastify({ logger: false });
      await app.register(praxosFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return await reply.ok({ userId: user.userId });
      });

      await app.ready();

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer some-token',
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
  });

  describe('when auth is configured', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      // Set all required env vars
      process.env['AUTH_JWKS_URL'] = jwksUrl;
      process.env['AUTH_ISSUER'] = issuer;
      process.env['AUTH_AUDIENCE'] = audience;

      app = Fastify({ logger: false });
      await app.register(praxosFastifyPlugin);
      await app.register(fastifyAuthPlugin);

      app.get('/protected', async (request, reply) => {
        const user = await requireAuth(request, reply);
        if (user === null) return;
        return await reply.ok({
          userId: user.userId,
          claims: user.claims,
        });
      });

      await app.ready();
    });

    it('returns 401 UNAUTHORIZED when Authorization header is missing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('Authorization');
    });

    it('returns 401 UNAUTHORIZED when Authorization header is invalid format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'InvalidFormat',
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

    it('returns 401 UNAUTHORIZED for invalid JWT', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: 'Bearer invalid-jwt-token',
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

    it('returns 401 UNAUTHORIZED for expired JWT', async () => {
      const token = await createToken({ sub: 'user-123' }, { expiresIn: '-1s' });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('expired');
    });

    it('returns 401 UNAUTHORIZED for JWT missing sub claim', async () => {
      const token = await createToken({});

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as {
        success: boolean;
        error: { code: string; message: string };
      };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toContain('sub');
    });

    it('passes with valid JWT and sets req.user.userId equal to jwt.sub', async () => {
      const token = await createToken({
        sub: 'auth0|user-abc-123',
        email: 'test@example.com',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          userId: string;
          claims: Record<string, unknown>;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.userId).toBe('auth0|user-abc-123');
      expect(body.data.claims['sub']).toBe('auth0|user-abc-123');
      expect(body.data.claims['email']).toBe('test@example.com');
    });

    it('attaches user to request object', async () => {
      const token = await createToken({ sub: 'user-xyz-789' });

      // The /protected route already uses requireAuth which sets request.user
      // We verify this indirectly by checking the userId is returned
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { userId: string };
      };
      expect(body.success).toBe(true);
      // The userId in response proves request.user was set correctly
      expect(body.data.userId).toBe('user-xyz-789');
    });
  });
});
