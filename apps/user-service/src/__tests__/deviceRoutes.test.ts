/**
 * Tests for POST /auth/device/start and POST /auth/device/poll
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { FakeAuthTokenRepository, FakeUserSettingsRepository } from './fakes.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('Device Authorization Flow', () => {
  let app: FastifyInstance;
  let fakeTokenRepo: FakeAuthTokenRepository;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    delete process.env['INTEXURAOS_AUTH0_DOMAIN'];
    delete process.env['INTEXURAOS_AUTH0_CLIENT_ID'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    nock.cleanAll();
    resetServices();

    // Create fake repository for token storage tests
    fakeTokenRepo = new FakeAuthTokenRepository();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
  });

  describe('POST /auth/device/start', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED when INTEXURAOS_AUTH0_DOMAIN is missing', async () => {
        process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
        process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: {},
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

      it('returns expected fields on success', async () => {
        const mockResponse = {
          device_code: 'DEVICE-CODE-123',
          user_code: 'ABCD-EFGH',
          verification_uri: `https://${INTEXURAOS_AUTH0_DOMAIN}/activate`,
          verification_uri_complete: `https://${INTEXURAOS_AUTH0_DOMAIN}/activate?user_code=ABCD-EFGH`,
          expires_in: 900,
          interval: 5,
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/device/code')
          .reply(200, mockResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: {},
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockResponse;
          diagnostics: { requestId: string };
        };
        expect(body.success).toBe(true);
        expect(body.data.device_code).toBe('DEVICE-CODE-123');
        expect(body.data.user_code).toBe('ABCD-EFGH');
        expect(body.data.verification_uri).toBe(`https://${INTEXURAOS_AUTH0_DOMAIN}/activate`);
        expect(body.data.verification_uri_complete).toContain('ABCD-EFGH');
        expect(body.data.expires_in).toBe(900);
        expect(body.data.interval).toBe(5);
        expect(body.diagnostics.requestId).toBeDefined();
      });

      it('uses custom audience when provided', async () => {
        const customAudience = 'https://custom.api.example.com';
        const mockResponse = {
          device_code: 'DEVICE-CODE-123',
          user_code: 'ABCD-EFGH',
          verification_uri: `https://${INTEXURAOS_AUTH0_DOMAIN}/activate`,
          verification_uri_complete: `https://${INTEXURAOS_AUTH0_DOMAIN}/activate?user_code=ABCD-EFGH`,
          expires_in: 900,
          interval: 5,
        };

        let receivedBody = '';

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/device/code')
          .reply(200, function (_uri, requestBody) {
            receivedBody = Buffer.isBuffer(requestBody)
              ? requestBody.toString('utf8')
              : typeof requestBody === 'string'
                ? requestBody
                : JSON.stringify(requestBody);
            return mockResponse;
          });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: { audience: customAudience },
        });

        expect(response.statusCode).toBe(200);
        expect(receivedBody).toContain(`audience=${encodeURIComponent(customAudience)}`);
      });

      it('returns 400 when audience format is invalid', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: { audience: 'not-a-valid-uri' },
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
      });

      it('handles Auth0 error response', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`).post('/oauth/device/code').reply(400, {
          error: 'invalid_client',
          error_description: 'Client is not authorized for device flow',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: {},
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
          diagnostics: { downstreamStatus: number };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
        expect(body.error.message).toContain('device flow');
        expect(body.diagnostics.downstreamStatus).toBe(400);
      });

      it('handles Auth0 error response without error_description', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`).post('/oauth/device/code').reply(400, {
          error: 'invalid_scope',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: {},
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
          diagnostics: { downstreamStatus: number };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
        expect(body.error.message).toBe('invalid_scope');
        expect(body.diagnostics.downstreamStatus).toBe(400);
      });

      it('handles non-Auth0 error response for device/start', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/device/code')
          .reply(500, 'Internal Server Error');

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: {},
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
        expect(body.error.message).toContain('failed');
      });

      it('handles network error for device/start', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/device/code')
          .replyWithError('Connection refused');

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/start',
          payload: {},
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
        expect(body.error.message).toContain('failed');
      });
    });
  });

  describe('POST /auth/device/poll', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-code' },
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

        // Inject fake repository to avoid Firestore connection during token storage
        setServices({
          authTokenRepository: fakeTokenRepo,
          userSettingsRepository: new FakeUserSettingsRepository(),
          auth0Client: null, // Not used in device flow (uses direct HTTP calls)
          encryptor: null,
          llmValidator: null,
        });
      });

      it('returns 400 when device_code is missing', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: {},
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; details: { errors: { path: string }[] } };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('INVALID_REQUEST');
        expect(body.error.details.errors).toHaveLength(1);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        expect(body.error.details.errors[0]!.path).toBe('device_code');
      });

      it('returns 409 CONFLICT when authorization pending', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`).post('/oauth/token').reply(403, {
          error: 'authorization_pending',
          error_description: 'User has not authorized yet',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(409);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('CONFLICT');
        expect(body.error.message).toContain('pending');
      });

      it('returns 409 CONFLICT when slow_down', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`).post('/oauth/token').reply(403, {
          error: 'slow_down',
          error_description: 'You are polling too quickly',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(409);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('CONFLICT');
        expect(body.error.message).toContain('fast');
      });

      it('returns token payload on success', async () => {
        const mockTokenResponse = {
          access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.test-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email',
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBe(mockTokenResponse.access_token);
        expect(body.data.token_type).toBe('Bearer');
        expect(body.data.expires_in).toBe(3600);
        expect(body.data.scope).toBe('openid profile email');
      });

      it('handles expired token error', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`).post('/oauth/token').reply(400, {
          error: 'expired_token',
          error_description: 'Device code has expired',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'expired-device-code' },
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
        expect(body.error.message).toContain('expired');
      });

      it('handles Auth0 error without error_description for device/poll', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`).post('/oauth/token').reply(400, {
          error: 'access_denied',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
        expect(body.error.message).toBe('access_denied');
      });

      it('handles non-Auth0 error response', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(500, 'Internal Server Error');

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      });

      it('handles network error', async () => {
        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .replyWithError('Connection refused');

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(502);
        const body = JSON.parse(response.body) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('DOWNSTREAM_ERROR');
      });

      it('returns success and attempts to store refresh token when provided', async () => {
        // Create a valid JWT-like access token with a sub claim
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
        const payload = Buffer.from(JSON.stringify({ sub: 'auth0|user-123' })).toString('base64');
        const signature = 'test-signature';
        const accessToken = `${header}.${payload}.${signature}`;

        const mockTokenResponse = {
          access_token: accessToken,
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email offline_access',
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { access_token: string; token_type: string; expires_in: number };
        };
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBe(accessToken);

        // Verify token was stored in the fake repository
        const storedTokens = fakeTokenRepo.getStoredTokens('auth0|user-123');
        expect(storedTokens).toBeDefined();
        expect(storedTokens?.refreshToken).toBe('test-refresh-token');
        expect(storedTokens?.accessToken).toBe(accessToken);
      });

      it('handles invalid JWT format gracefully when storing refresh token', async () => {
        const mockTokenResponse = {
          access_token: 'not.a.valid.jwt.token.with.too.many.parts',
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        // Request should succeed - storeRefreshToken is best-effort
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
      });

      it('handles JWT with missing sub claim gracefully', async () => {
        // Create a JWT without a sub claim
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
        const payload = Buffer.from(JSON.stringify({ aud: 'test-audience' })).toString('base64');
        const signature = 'test-signature';
        const accessToken = `${header}.${payload}.${signature}`;

        const mockTokenResponse = {
          access_token: accessToken,
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        // Request should succeed - storeRefreshToken exits early for missing sub
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
      });

      it('handles JWT with empty sub claim gracefully', async () => {
        // Create a JWT with an empty sub claim
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
        const payload = Buffer.from(JSON.stringify({ sub: '' })).toString('base64');
        const signature = 'test-signature';
        const accessToken = `${header}.${payload}.${signature}`;

        const mockTokenResponse = {
          access_token: accessToken,
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        // Request should succeed - storeRefreshToken exits early for empty sub
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
      });

      it('handles malformed JWT payload gracefully', async () => {
        // Create a JWT with invalid base64 payload
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
        const invalidPayload = '!!!not-valid-base64!!!';
        const signature = 'test-signature';
        const accessToken = `${header}.${invalidPayload}.${signature}`;

        const mockTokenResponse = {
          access_token: accessToken,
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        // Request should succeed - storeRefreshToken catches the parse error
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
      });

      it('handles two-part JWT gracefully', async () => {
        const mockTokenResponse = {
          access_token: 'header.payload', // Only 2 parts, not 3
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        // Request should succeed - storeRefreshToken exits early for invalid token format
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
      });

      it('does not attempt to store token when refresh_token is missing', async () => {
        const mockTokenResponse = {
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email',
          // No refresh_token
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBe(mockTokenResponse.access_token);
      });

      it('does not attempt to store token when refresh_token is empty', async () => {
        const mockTokenResponse = {
          access_token: 'test-access-token',
          refresh_token: '',
          token_type: 'Bearer',
          expires_in: 3600,
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: typeof mockTokenResponse;
        };
        expect(body.success).toBe(true);
      });

      it('logs warning when saveTokens fails but still returns success', async () => {
        // Create a valid JWT-like access token with a sub claim
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
        const payload = Buffer.from(JSON.stringify({ sub: 'auth0|user-456' })).toString('base64');
        const signature = 'test-signature';
        const accessToken = `${header}.${payload}.${signature}`;

        const mockTokenResponse = {
          access_token: accessToken,
          refresh_token: 'test-refresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'openid profile email offline_access',
        };

        nock(`https://${INTEXURAOS_AUTH0_DOMAIN}`)
          .post('/oauth/token')
          .reply(200, mockTokenResponse);

        // Configure the fake repository to fail the next saveTokens call
        fakeTokenRepo.setFailNextSaveTokens(true);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/auth/device/poll',
          payload: { device_code: 'test-device-code' },
        });

        // Request should succeed - storeRefreshToken is best-effort
        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as {
          success: boolean;
          data: { access_token: string; token_type: string; expires_in: number };
        };
        expect(body.success).toBe(true);
        expect(body.data.access_token).toBe(accessToken);

        // Verify token was NOT stored due to simulated failure
        const storedTokens = fakeTokenRepo.getStoredTokens('auth0|user-456');
        expect(storedTokens).toBeUndefined();
      });
    });
  });
});
