/**
 * Tests for GET /auth/config
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import nock from 'nock';
import { buildServer } from '../server.js';

const INTEXURAOS_AUTH0_DOMAIN = 'test-tenant.eu.auth0.com';
const INTEXURAOS_AUTH0_CLIENT_ID = 'test-client-id';
const INTEXURAOS_AUTH_AUDIENCE = 'urn:intexuraos:api';

describe('GET /auth/config', () => {
  let app: FastifyInstance;

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
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 503 MISCONFIGURED when config missing', async () => {
    app = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/auth/config',
    });

    expect(response.statusCode).toBe(503);
    const body = JSON.parse(response.body) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('MISCONFIGURED');
  });

  it('returns auth configuration when configured', async () => {
    process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
    process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;

    app = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/auth/config',
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
    expect(body.data.domain).toBe(INTEXURAOS_AUTH0_DOMAIN);
    expect(body.data.issuer).toBe(`https://${INTEXURAOS_AUTH0_DOMAIN}/`);
    expect(body.data.audience).toBe(INTEXURAOS_AUTH_AUDIENCE);
    expect(body.data.jwksUrl).toBe(`https://${INTEXURAOS_AUTH0_DOMAIN}/.well-known/jwks.json`);
  });

  it('does not expose client_id in config response', async () => {
    process.env['INTEXURAOS_AUTH0_DOMAIN'] = INTEXURAOS_AUTH0_DOMAIN;
    process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = INTEXURAOS_AUTH0_CLIENT_ID;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = INTEXURAOS_AUTH_AUDIENCE;

    app = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/auth/config',
    });

    expect(response.statusCode).toBe(200);
    const bodyStr = response.body;
    expect(bodyStr).not.toContain(INTEXURAOS_AUTH0_CLIENT_ID);
  });
});
