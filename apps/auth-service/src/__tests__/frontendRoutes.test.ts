/**
 * Tests for GET /v1/auth/login, GET /v1/auth/logout, GET /v1/auth/me
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@praxos/common';
import { buildServer } from '../server.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = 'test-client-id';
const AUTH_AUDIENCE = 'urn:praxos:api';

describe('Frontend Auth Routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_CLIENT_ID'];
    delete process.env['AUTH_AUDIENCE'];
    delete process.env['AUTH_JWKS_URL'];
    delete process.env['AUTH_ISSUER'];
    clearJwksCache();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /v1/auth/login', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED when AUTH0_DOMAIN is missing', async () => {
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;

        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/login?redirect_uri=https://example.com/callback',
        });

        expect(response.statusCode).toBe(503);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('MISCONFIGURED');
        expect(body.error.message).toContain('AUTH0_DOMAIN');
      });
    });

    describe('when config is valid', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
      });

      it('returns 400 when redirect_uri missing', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/login',
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
        expect(body.error.message).toBe('redirect_uri is required');
      });

      it('redirects to Auth0 with correct parameters', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/login?redirect_uri=https://app.example.com/callback&state=csrf-token-123',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${AUTH0_DOMAIN}/authorize`);
        expect(location).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback');
        expect(location).toContain('response_type=code');
        expect(location).toContain(`client_id=${AUTH0_CLIENT_ID}`);
        expect(location).toContain('scope=openid+profile+email+offline_access');
        expect(location).toContain(`audience=${encodeURIComponent(AUTH_AUDIENCE)}`);
        expect(location).toContain('state=csrf-token-123');
      });

      it('redirects without state when not provided', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/login?redirect_uri=https://app.example.com/callback',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${AUTH0_DOMAIN}/authorize`);
        expect(location).not.toContain('state=');
      });
    });
  });

  describe('GET /v1/auth/logout', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/logout?return_to=https://example.com',
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

    describe('when config is valid', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
      });

      it('returns 400 when return_to missing', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/logout',
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
        expect(body.error.message).toBe('return_to is required');
      });

      it('redirects to Auth0 logout with correct parameters', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/logout?return_to=https://app.example.com',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${AUTH0_DOMAIN}/v2/logout`);
        expect(location).toContain(`client_id=${AUTH0_CLIENT_ID}`);
        expect(location).toContain('returnTo=https%3A%2F%2Fapp.example.com');
      });
    });
  });

  describe('GET /v1/auth/me', () => {
    let jwksServer: FastifyInstance;
    let privateKey: jose.KeyLike;
    let jwksUrl: string;
    const issuer = `https://${AUTH0_DOMAIN}/`;

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

    describe('when not authenticated', () => {
      it('returns 401 when no auth token', async () => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        process.env['AUTH_JWKS_URL'] = jwksUrl;
        process.env['AUTH_ISSUER'] = issuer;

        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/me',
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
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        process.env['AUTH_JWKS_URL'] = jwksUrl;
        process.env['AUTH_ISSUER'] = issuer;

        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/me',
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
    });

    describe('when authenticated', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        process.env['AUTH_JWKS_URL'] = jwksUrl;
        process.env['AUTH_ISSUER'] = issuer;
      });

      it('returns user info with all claims', async () => {
        app = await buildServer();

        const token = await createToken({
          sub: 'auth0|user-123',
          email: 'test@example.com',
          name: 'Test User',
          picture: 'https://example.com/avatar.png',
        });

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/me',
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: {
            userId: string;
            email: string;
            name: string;
            picture: string;
            hasRefreshToken: boolean;
          };
        };
        expect(body.success).toBe(true);
        expect(body.data.userId).toBe('auth0|user-123');
        expect(body.data.email).toBe('test@example.com');
        expect(body.data.name).toBe('Test User');
        expect(body.data.picture).toBe('https://example.com/avatar.png');
        expect(typeof body.data.hasRefreshToken).toBe('boolean');
      });

      it('returns user info without optional claims', async () => {
        app = await buildServer();

        const token = await createToken({
          sub: 'auth0|user-456',
        });

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/me',
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: {
            userId: string;
            hasRefreshToken: boolean;
          };
        };
        expect(body.success).toBe(true);
        expect(body.data.userId).toBe('auth0|user-456');
        expect(typeof body.data.hasRefreshToken).toBe('boolean');
        expect(body.data).not.toHaveProperty('email');
        expect(body.data).not.toHaveProperty('name');
        expect(body.data).not.toHaveProperty('picture');
      });
    });
  });
});
