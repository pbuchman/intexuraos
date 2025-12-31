/**
 * Tests for system endpoints: /health, /docs, /openapi.json
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';

describe('System Endpoints', () => {
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

  it('GET /health returns health status', async () => {
    process.env['AUTH0_DOMAIN'] = 'test-tenant.eu.auth0.com';
    process.env['AUTH0_CLIENT_ID'] = 'test-client-id';
    process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    process.env['INTEXURAOS_TOKEN_ENCRYPTION_KEY'] = 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcw==';

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
    expect(body.serviceName).toBe('user-service');
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
    expect(spec.info.title).toBe('user-service');
    expect(spec.paths['/auth/device/start']).toBeDefined();
    expect(spec.paths['/auth/device/poll']).toBeDefined();
    expect(spec.paths['/auth/config']).toBeDefined();
    expect(spec.paths['/auth/oauth/token']).toBeDefined();
  });
});
