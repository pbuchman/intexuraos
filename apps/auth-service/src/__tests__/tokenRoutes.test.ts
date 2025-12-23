/**
 * Tests for POST /v1/auth/refresh
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';
const AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const AUTH0_CLIENT_ID = 'test-client-id';
describe('Token Refresh Routes', () => {
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
    delete process.env['PRAXOS_TOKEN_ENCRYPTION_KEY'];
    nock.cleanAll();
  });
  afterEach(async () => {
    await app.close();
  });
  describe('POST /v1/auth/refresh', () => {
    describe('when config is missing', () => {
      it('returns 503 MISCONFIGURED when AUTH0_DOMAIN is missing', async () => {
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
        app = await buildServer();
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
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
        app = await buildServer();
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
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
    });
    describe('validation', () => {
      beforeEach(() => {
        process.env['AUTH0_DOMAIN'] = AUTH0_DOMAIN;
        process.env['AUTH0_CLIENT_ID'] = AUTH0_CLIENT_ID;
      });
      it('returns 400 INVALID_REQUEST when userId is missing', async () => {
        app = await buildServer();
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
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
          url: '/v1/auth/refresh',
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
  });
});
