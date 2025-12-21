import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';

describe('auth-service v1 endpoints', () => {
  let app: FastifyInstance;

  const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
  const AUTH0_CLIENT_ID = 'test-client-id';
  const AUTH_AUDIENCE = 'urn:praxos:api';

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    // Clear env vars before each test
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_CLIENT_ID'];
    delete process.env['AUTH_AUDIENCE'];
    nock.cleanAll();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('503 MISCONFIGURED when env missing', () => {
    it('POST /v1/auth/device/start returns 503 when AUTH0_DOMAIN is missing', async () => {
      process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
      process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
      // AUTH0_DOMAIN not set

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

    it('POST /v1/auth/device/poll returns 503 when config missing', async () => {
      // No env vars set
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

    it('GET /v1/auth/config returns 503 when config missing', async () => {
      // No env vars set
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/config',
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

  describe('POST /v1/auth/device/start', () => {
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

  describe('POST /v1/auth/device/poll', () => {
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

  describe('GET /v1/auth/config', () => {
    it('returns auth configuration when configured', async () => {
      process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
      process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
      process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/config',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: {
          domain: string;
          issuer: string;
          audience: string;
          jwksUrl: string;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.domain).toBe(AUTH0_DOMAIN);
      expect(body.data.issuer).toBe(`https://${AUTH0_DOMAIN}/`);
      expect(body.data.audience).toBe(AUTH_AUDIENCE);
      expect(body.data.jwksUrl).toBe(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`);
    });

    it('does not expose client_id in config response', async () => {
      process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
      process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
      process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/auth/config',
      });

      expect(response.statusCode).toBe(200);
      const bodyStr = response.body;
      expect(bodyStr).not.toContain(AUTH0_CLIENT_ID);
    });
  });

  describe('System endpoints', () => {
    it('GET /health returns health status', async () => {
      // Set all required env vars for the health check
      process.env['AUTH0_DOMAIN'] = 'test-tenant.eu.auth0.com';
      process.env['AUTH0_CLIENT_ID'] = 'test-client-id';
      process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
      process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
      process.env['AUTH_AUDIENCE'] = 'urn:praxos:api';
      process.env['PRAXOS_TOKEN_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcw==';

      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        status: string;
        serviceName: string;
        version: string;
        checks: { name: string; status: string }[];
      };
      expect(body.status).toBe('ok');
      expect(body.serviceName).toBe('auth-service');
      expect(body.checks).toBeInstanceOf(Array);
    });

    it('GET /docs returns Swagger UI', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/docs',
      });

      // Swagger UI redirects to /docs/
      expect([200, 302]).toContain(response.statusCode);
    });

    it('GET /openapi.json returns OpenAPI spec', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });

      expect(response.statusCode).toBe(200);
      const spec = JSON.parse(response.body) as {
        openapi: string;
        info: { title: string };
        paths: Record<string, unknown>;
      };
      expect(spec.openapi).toMatch(/^3\./);
      expect(spec.info.title).toBe('auth-service');
      expect(spec.paths['/v1/auth/device/start']).toBeDefined();
      expect(spec.paths['/v1/auth/device/poll']).toBeDefined();
      expect(spec.paths['/v1/auth/config']).toBeDefined();
      expect(spec.paths['/v1/auth/oauth/token']).toBeDefined();
    });
  });

  describe('POST /v1/auth/oauth/token', () => {
    beforeEach(() => {
      process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
      process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
      process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
    });

    it('returns 400 when config missing', async () => {
      delete process.env['AUTH0_DOMAIN'];
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'test-client',
          client_secret: 'test-secret',
          code: 'test-code',
          redirect_uri: 'https://example.com/callback',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('server_error');
    });

    it('returns 400 when code missing for authorization_code grant', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'test-client',
          client_secret: 'test-secret',
          redirect_uri: 'https://example.com/callback',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string; error_description: string };
      expect(body.error).toBe('invalid_request');
      expect(body.error_description).toContain('code');
    });

    it('returns 400 when redirect_uri missing for authorization_code grant', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'test-client',
          client_secret: 'test-secret',
          code: 'test-code',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string; error_description: string };
      expect(body.error).toBe('invalid_request');
      expect(body.error_description).toContain('redirect_uri');
    });

    it('returns 400 when refresh_token missing for refresh_token grant', async () => {
      app = await buildServer();

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          client_id: 'test-client',
          client_secret: 'test-secret',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string; error_description: string };
      expect(body.error).toBe('invalid_request');
      expect(body.error_description).toContain('refresh_token');
    });

    it('exchanges authorization code for tokens successfully', async () => {
      app = await buildServer();

      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(200, {
        access_token: 'test-access-token',
        token_type: 'Bearer',
        expires_in: 86400,
        refresh_token: 'test-refresh-token',
        scope: 'openid profile email',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'test-client',
          client_secret: 'test-secret',
          code: 'test-code',
          redirect_uri: 'https://example.com/callback',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        access_token: string;
        token_type: string;
        expires_in: number;
        refresh_token: string;
      };
      expect(body.access_token).toBe('test-access-token');
      expect(body.token_type).toBe('Bearer');
      expect(body.expires_in).toBe(86400);
      expect(body.refresh_token).toBe('test-refresh-token');
    });

    it('refreshes token successfully', async () => {
      app = await buildServer();

      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(200, {
        access_token: 'new-access-token',
        token_type: 'Bearer',
        expires_in: 86400,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'refresh_token',
          client_id: 'test-client',
          client_secret: 'test-secret',
          refresh_token: 'old-refresh-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        access_token: string;
        token_type: string;
      };
      expect(body.access_token).toBe('new-access-token');
    });

    it('returns Auth0 error on invalid credentials', async () => {
      app = await buildServer();

      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(401, {
        error: 'invalid_client',
        error_description: 'Client authentication failed',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'bad-client',
          client_secret: 'bad-secret',
          code: 'test-code',
          redirect_uri: 'https://example.com/callback',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { error: string; error_description: string };
      expect(body.error).toBe('invalid_client');
    });

    it('returns error on Auth0 failure', async () => {
      app = await buildServer();

      nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(400, {
        error: 'invalid_grant',
        error_description: 'Invalid authorization code',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/oauth/token',
        payload: {
          grant_type: 'authorization_code',
          client_id: 'test-client',
          client_secret: 'test-secret',
          code: 'expired-code',
          redirect_uri: 'https://example.com/callback',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toBe('invalid_grant');
    });
  });
});
