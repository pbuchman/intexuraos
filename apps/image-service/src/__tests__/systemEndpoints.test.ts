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
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'urn:intexuraos:api';
    nock.cleanAll();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /health returns health status', async () => {
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
    expect(body.serviceName).toBe('image-service');
    expect(body.checks).toBeInstanceOf(Array);
  });

  it('GET /docs returns Swagger UI', async () => {
    app = await buildServer();

    const response = await app.inject({
      method: 'GET',
      url: '/docs',
    });

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
    expect(spec.info.title).toBe('image-service');
    expect(spec.paths['/prompts/generate']).toBeDefined();
    expect(spec.paths['/images/generate']).toBeDefined();
  });
});
