/**
 * Tests for POST /auth/refresh
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ok, err } from '@intexuraos/common-core';
import { buildServer } from '../server.js';
import { setServices, resetServices } from '../services.js';
import { FakeAuthTokenRepository, FakeAuth0Client, FakeUserSettingsRepository } from './fakes.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = 'test-client-id';
const AUTH_AUDIENCE = 'https://api.test.com';

describe('Token Refresh Routes', () => {
  let app: FastifyInstance;
  let fakeTokenRepo: FakeAuthTokenRepository;
  let fakeAuth0Client: FakeAuth0Client;

  beforeEach(() => {
    // Clear environment
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_CLIENT_ID'];
    delete process.env['AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'];

    // Reset services before each test
    resetServices();

    // Create fakes
    fakeTokenRepo = new FakeAuthTokenRepository();
    fakeAuth0Client = new FakeAuth0Client();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /auth/refresh', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED when AUTH0_DOMAIN is missing', async () => {
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(503);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('MISCONFIGURED');
      });

      it('returns 503 MISCONFIGURED when AUTH0_CLIENT_ID is missing', async () => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(503);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('MISCONFIGURED');
      });

      it('returns 503 MISCONFIGURED when AUTH_AUDIENCE is missing', async () => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(503);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('MISCONFIGURED');
      });

      it('returns 503 MISCONFIGURED when auth0Client is null', async () => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;

        // Set services with null auth0Client
        setServices({
          authTokenRepository: fakeTokenRepo,
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: null,
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(503);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('MISCONFIGURED');
        expect(body.error.message).toContain('refresh operations');
      });
    });

    describe('validation', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        setServices({
          authTokenRepository: fakeTokenRepo,
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: fakeAuth0Client,
        });
      });

      it('returns 400 INVALID_REQUEST when userId is missing', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: {},
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
      });

      it('returns 400 INVALID_REQUEST when userId is empty', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: '' },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
      });
    });

    describe('token retrieval errors', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        setServices({
          authTokenRepository: fakeTokenRepo,
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: fakeAuth0Client,
        });
      });

      it('returns 500 INTERNAL_ERROR when getRefreshToken fails', async () => {
        fakeTokenRepo.setFailNextGetRefreshToken(true);
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
        expect(body.error.message).toContain('retrieve refresh token');
      });

      it('returns 401 UNAUTHORIZED when no refresh token found', async () => {
        // No tokens stored for user
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-without-token' },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(body.error.message).toContain('re-authenticate');
      });
    });

    describe('Auth0 refresh errors', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        setServices({
          authTokenRepository: fakeTokenRepo,
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: fakeAuth0Client,
        });

        // Store a refresh token for tests
        fakeTokenRepo.setTokens('user-123', {
          accessToken: 'old-access-token',
          refreshToken: 'valid-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
        });
      });

      it('returns 401 UNAUTHORIZED when Auth0 returns invalid_grant', async () => {
        fakeAuth0Client.setNextResult(
          err({
            code: 'INVALID_GRANT',
            message: 'Refresh token is invalid or expired',
          })
        );
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(401);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNAUTHORIZED');
        expect(body.error.message).toContain('invalid or expired');

        // Verify tokens were deleted
        expect(fakeTokenRepo.getStoredTokens('user-123')).toBeUndefined();
      });

      it('returns 502 DOWNSTREAM_ERROR when Auth0 returns other errors', async () => {
        fakeAuth0Client.setNextResult(
          err({
            code: 'INTERNAL_ERROR',
            message: 'Auth0 service unavailable',
          })
        );
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
        expect(body.error.message).toContain('refresh failed');
      });

      it('returns 500 INTERNAL_ERROR when Auth0 throws exception', async () => {
        fakeAuth0Client.setThrowOnNextCall(true);
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(500);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INTERNAL_ERROR');
      });
    });

    describe('successful refresh', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
        setServices({
          authTokenRepository: fakeTokenRepo,
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: fakeAuth0Client,
        });

        // Store a refresh token for tests
        fakeTokenRepo.setTokens('user-123', {
          accessToken: 'old-access-token',
          refreshToken: 'valid-refresh-token',
          tokenType: 'Bearer',
          expiresIn: 3600,
        });
      });

      it('returns new tokens on successful refresh', async () => {
        fakeAuth0Client.setNextResult(
          ok({
            accessToken: 'new-access-token',
            tokenType: 'Bearer',
            expiresIn: 7200,
            scope: 'openid profile email',
            idToken: 'new-id-token',
            refreshToken: undefined,
          })
        );
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: {
            access_token: string;
            token_type: string;
            expires_in: number;
            scope: string;
            id_token: string;
          };
        };
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBe('new-access-token');
        expect(body.data.token_type).toBe('Bearer');
        expect(body.data.expires_in).toBe(7200);
        expect(body.data.scope).toBe('openid profile email');
        expect(body.data.id_token).toBe('new-id-token');
      });

      it('stores new refresh token when rotation enabled', async () => {
        fakeAuth0Client.setNextResult(
          ok({
            accessToken: 'new-access-token',
            tokenType: 'Bearer',
            expiresIn: 7200,
            scope: 'openid profile email',
            idToken: 'new-id-token',
            refreshToken: 'rotated-refresh-token',
          })
        );
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(200);

        // Verify the rotated refresh token was stored
        const storedTokens = fakeTokenRepo.getStoredTokens('user-123');
        expect(storedTokens?.refreshToken).toBe('rotated-refresh-token');
      });

      it('keeps original refresh token when rotation not enabled', async () => {
        fakeAuth0Client.setNextResult(
          ok({
            accessToken: 'new-access-token',
            tokenType: 'Bearer',
            expiresIn: 7200,
            scope: 'openid profile email',
            idToken: 'new-id-token',
            refreshToken: undefined, // No rotation
          })
        );
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(200);

        // Verify the original refresh token is preserved
        const storedTokens = fakeTokenRepo.getStoredTokens('user-123');
        expect(storedTokens?.refreshToken).toBe('valid-refresh-token');
      });

      it('returns tokens without optional scope and idToken when not provided', async () => {
        fakeAuth0Client.setNextResult(
          ok({
            accessToken: 'new-access-token',
            tokenType: 'Bearer',
            expiresIn: 7200,
            scope: undefined,
            idToken: undefined,
            refreshToken: undefined,
          })
        );
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: {
            access_token: string;
            token_type: string;
            expires_in: number;
            scope?: string;
            id_token?: string;
          };
        };
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBe('new-access-token');
        expect(body.data.token_type).toBe('Bearer');
        expect(body.data.expires_in).toBe(7200);
        // Verify optional fields are not present when undefined
        expect(body.data.scope).toBeUndefined();
        expect(body.data.id_token).toBeUndefined();
      });

      it('succeeds even when saveTokens fails (warning logged)', async () => {
        fakeAuth0Client.setNextResult(
          ok({
            accessToken: 'new-access-token',
            tokenType: 'Bearer',
            expiresIn: 7200,
            scope: 'openid profile email',
            idToken: 'new-id-token',
            refreshToken: undefined,
          })
        );
        fakeTokenRepo.setFailNextSaveTokens(true);
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/refresh',
          payload: { userId: 'user-123' },
        });

        // Should still return 200 - save failure is logged but doesn't fail request
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { access_token: string };
        };
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBe('new-access-token');
      });
    });
  });
});
