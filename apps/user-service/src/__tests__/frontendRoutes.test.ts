/**
 * Tests for GET /auth/login, GET /auth/logout, GET /auth/me
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import * as jose from 'jose';
import { clearJwksCache } from '@intexuraos/common-http';
import { buildServer } from '../server.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('Frontend Auth Routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    delete process.env['INTEXURAOS_AUTH0_DOMAIN'];
    delete process.env['INTEXURAOS_AUTH0_CLIENT_ID'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    clearJwksCache();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /auth/login', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED when INTEXURAOS_AUTH0_DOMAIN is missing', async () => {
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;

        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/auth/login?redirect_uri=https://example.com/callback',
        });

        expect(response.statusCode).toBe(503);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('MISCONFIGURED');
        expect(body.error.message).toContain('INTEXURAOS_AUTH0_DOMAIN');
      });
    });

    describe('when config is valid', () => {
      beforeEach(() => {
        process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
      });

      it('returns 400 when redirect_uri missing', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/auth/login',
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
          url: '/auth/login?redirect_uri=https://app.example.com/callback&state=csrf-token-123',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${INTEXURAOS_AUTH0_DOMAIN}/authorize`);
        expect(location).toContain('redirect_uri=https%3A%2F%2Fapp.example.com%2Fcallback');
        expect(location).toContain('response_type=code');
        expect(location).toContain(`client_id=${INTEXURAOS_AUTH0_CLIENT_ID}`);
        expect(location).toContain('scope=openid+profile+email+offline_access');
        expect(location).toContain(`audience=${encodeURIComponent(INTEXURAOS_AUTH_AUDIENCE)}`);
        expect(location).toContain('state=csrf-token-123');
      });

      it('redirects without state when not provided', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/auth/login?redirect_uri=https://app.example.com/callback',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${INTEXURAOS_AUTH0_DOMAIN}/authorize`);
        expect(location).not.toContain('state=');
      });
    });
  });

  describe('GET /auth/logout', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/auth/logout?return_to=https://example.com',
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
        process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
      });

      it('returns 400 when return_to missing', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/auth/logout',
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
          url: '/auth/logout?return_to=https://app.example.com',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${INTEXURAOS_AUTH0_DOMAIN}/v2/logout`);
        expect(location).toContain(`client_id=${INTEXURAOS_AUTH0_CLIENT_ID}`);
        expect(location).toContain('returnTo=https%3A%2F%2Fapp.example.com');
      });
    });

    describe('when authenticated with token deletion error', () => {
      let jwksServer: FastifyInstance;
      let privateKey: jose.KeyLike;
      let jwksUrl: string;
      const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

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

      it('still redirects when token deletion throws', { timeout: 20000 }, async () => {
        process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
        process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
        process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;

        const { setServices, resetServices } = await import('../services.js');
        const {
          FakeAuthTokenRepository,
          FakeOAuthConnectionRepository,
          FakeUserSettingsRepository,
        } = await import('./fakes.js');

        const fakeTokenRepo = new FakeAuthTokenRepository();
        fakeTokenRepo.setThrowOnDeleteTokens(true);
        setServices({
          authTokenRepository: fakeTokenRepo,
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: null,
          encryptor: null,
          llmValidator: null,
          oauthConnectionRepository: new FakeOAuthConnectionRepository(),
          googleOAuthClient: null,
        });

        app = await buildServer();

        const token = await createToken({
          sub: 'auth0|user-123',
        });

        const response = await app.inject({
          method: 'GET',
          url: '/auth/logout?return_to=https://app.example.com',
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

        // Should still redirect despite token deletion error (best-effort cleanup)
        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${INTEXURAOS_AUTH0_DOMAIN}/v2/logout`);

        resetServices();
      });
    });
  });

  describe('GET /auth/me', () => {
    let jwksServer: FastifyInstance;
    let privateKey: jose.KeyLike;
    let jwksUrl: string;
    const issuer = `https://${INTEXURAOS_AUTH0_DOMAIN}/`;

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
        process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
        process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
        process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;

        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/auth/me',
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
        process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
        process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
        process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;

        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/auth/me',
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
      beforeEach(async () => {
        process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;
        process.env['INTEXURAOS_AUTH_JWKS_URL'] = jwksUrl;
        process.env['INTEXURAOS_AUTH_ISSUER'] = issuer;

        const { setServices } = await import('../services.js');
        const {
          FakeAuthTokenRepository,
          FakeOAuthConnectionRepository,
          FakeUserSettingsRepository,
        } = await import('./fakes.js');

        setServices({
          authTokenRepository: new FakeAuthTokenRepository(),
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: null,
          encryptor: null,
          llmValidator: null,
          oauthConnectionRepository: new FakeOAuthConnectionRepository(),
          googleOAuthClient: null,
        });
      });

      afterEach(async () => {
        const { resetServices } = await import('../services.js');
        resetServices();
      });

      it('returns user info with all claims', { timeout: 20000 }, async () => {
        app = await buildServer();

        const token = await createToken({
          sub: 'auth0|user-123',
          email: 'test@example.com',
          name: 'Test User',
          picture: 'https://example.com/avatar.png',
        });

        const response = await app.inject({
          method: 'GET',
          url: '/auth/me',
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

      it('returns user info without optional claims', { timeout: 20000 }, async () => {
        app = await buildServer();

        const token = await createToken({
          sub: 'auth0|user-456',
        });

        const response = await app.inject({
          method: 'GET',
          url: '/auth/me',
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

      it(
        'returns hasRefreshToken as false when repository throws',
        { timeout: 20000 },
        async () => {
          const { setServices, resetServices } = await import('../services.js');
          const {
            FakeAuthTokenRepository,
            FakeOAuthConnectionRepository,
            FakeUserSettingsRepository,
          } = await import('./fakes.js');

          const fakeTokenRepo = new FakeAuthTokenRepository();
          fakeTokenRepo.setThrowOnHasRefreshToken(true);
          setServices({
            authTokenRepository: fakeTokenRepo,
            userSettingsRepository: new FakeUserSettingsRepository(),
            auth0Client: null,
            encryptor: null,
            llmValidator: null,
            oauthConnectionRepository: new FakeOAuthConnectionRepository(),
            googleOAuthClient: null,
          });

          app = await buildServer();

          const token = await createToken({
            sub: 'auth0|user-789',
          });

          const response = await app.inject({
            method: 'GET',
            url: '/auth/me',
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
          expect(body.data.userId).toBe('auth0|user-789');
          // Should default to false when repository throws
          expect(body.data.hasRefreshToken).toBe(false);

          resetServices();
        }
      );
    });
  });
});
