/**
 * Tests for POST /v1/auth/oauth/token and GET /v1/auth/oauth/authorize
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';

const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = 'test-client-id';
const AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('OAuth2 Routes', () => {
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

  describe('POST /v1/auth/oauth/token', () => {
    describe('when config is missing', () => {
      it('returns 400 server_error', async () => {
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
    });

    describe('when config is valid', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        process.env['AUTH_AUDIENCE'] = AUTH_AUDIENCE;
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

      it('accepts form-urlencoded content type (OAuth2 standard)', async () => {
        app = await buildServer();

        nock(`https://${AUTH0_DOMAIN}`).post('/oauth/token').reply(200, {
          access_token: 'test-access-token',
          token_type: 'Bearer',
          expires_in: 86400,
        });

        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/oauth/token',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
          payload:
            'grant_type=authorization_code&client_id=test-client&client_secret=test-secret&code=test-code&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback',
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.body) as { access_token: string };
        expect(body.access_token).toBe('test-access-token');
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

  describe('GET /v1/auth/oauth/authorize', () => {
    describe('when config is missing', () => {
      it('returns 400 server_error', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/oauth/authorize?redirect_uri=https://example.com/callback',
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as { error: string };
        expect(body.error).toBe('server_error');
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
          url: '/v1/auth/oauth/authorize',
        });

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body) as { error: string; error_description: string };
        expect(body.error).toBe('invalid_request');
        expect(body.error_description).toContain('redirect_uri');
      });

      it('redirects to Auth0 with correct parameters', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/oauth/authorize?redirect_uri=https://chat.openai.com/callback&scope=openid&state=abc123',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain(`https://${AUTH0_DOMAIN}/authorize`);
        expect(location).toContain('redirect_uri=https%3A%2F%2Fchat.openai.com%2Fcallback');
        expect(location).toContain('scope=openid');
        expect(location).toContain('state=abc123');
        expect(location).toContain(`audience=${encodeURIComponent(AUTH_AUDIENCE)}`);
      });

      it('uses default scope when not provided', async () => {
        app = await buildServer();

        const response = await app.inject({
          method: 'GET',
          url: '/v1/auth/oauth/authorize?redirect_uri=https://example.com/callback',
        });

        expect(response.statusCode).toBe(302);
        const location = String(response.headers.location);
        expect(location).toContain('scope=openid+profile+email+offline_access');
      });
    });
  });
});
