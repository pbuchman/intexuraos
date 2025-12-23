/**
 * Tests for POST /v1/auth/device/start and POST /v1/auth/device/poll
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = 'test-client-id';
const AUTH_AUDIENCE = 'urn:praxos:api';

describe('Device Authorization Flow', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_CLIENT_ID'];
    delete process.env['AUTH_AUDIENCE'];
    nock.cleanAll();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/auth/device/start', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED when AUTH0_DOMAIN is missing', async () => {
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/start',
          payload: {},
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

      it('returns expected fields on success', async () => {
        const mockResponse = {
          device_code: 'DEVICE-CODE-123',
          user_code: 'ABCD-EFGH',
          verification_uri: `https://${AUTH0_DOMAIN}/activate`,
          verification_uri_complete: `https://${AUTH0_DOMAIN}/activate?user_code=ABCD-EFGH`,
          expires_in: 900,
          interval: 5,
        };

        nock(`https://${AUTH0_DOMAIN}`).post('/oauth/device/code').reply(200, mockResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/start',
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
        expect(body.data.verification_uri).toBe(`https://${AUTH0_DOMAIN}/activate`);
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
          verification_uri: `https://${AUTH0_DOMAIN}/activate`,
          verification_uri_complete: `https://${AUTH0_DOMAIN}/activate?user_code=ABCD-EFGH`,
          expires_in: 900,
          interval: 5,
        };

        let receivedBody = '';

        nock(`https://${AUTH0_DOMAIN}`)
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
          url: '/v1/auth/device/start',
          payload: { audience: customAudience },
        });

        expect(response.statusCode).toBe(200);
        expect(receivedBody).toContain(`audience=${encodeURIComponent(customAudience)}`);
      });

      it('handles Auth0 error response', async () => {
        nock(`https://${AUTH0_DOMAIN}`).post('/oauth/device/code').reply(400, {
          error: 'invalid_client',
          error_description: 'Client is not authorized for device flow',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/start',
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
    });
  });

  describe('POST /v1/auth/device/poll', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/poll',
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
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
      });

      it('returns 400 when device_code is missing', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/poll',
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
        nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(403, {
          error: 'authorization_pending',
          error_description: 'User has not authorized yet',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/poll',
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
        nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(403, {
          error: 'slow_down',
          error_description: 'You are polling too quickly',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/poll',
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

        nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(200, mockTokenResponse);

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/poll',
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
        nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(400, {
          error: 'expired_token',
          error_description: 'Device code has expired',
        });

        app = await buildServer();

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/device/poll',
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
    });
  });
});
