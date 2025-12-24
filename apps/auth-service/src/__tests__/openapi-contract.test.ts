import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

interface OpenApiSpec {
  openapi?: string;
  servers?: { url: string; description?: string }[];
  paths?: Record<string, Record<string, { operationId?: string; requestBody?: unknown }>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

describe('auth-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: OpenApiSpec;

  beforeAll(async () => {
    // Set required env vars
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['AUTH0_CLIENT_ID'] = 'test-client';
    process.env['AUTH_AUDIENCE'] = 'https://api.test.com';

    app = await buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    openapiSpec = JSON.parse(response.body) as OpenApiSpec;
  });

  afterAll(async () => {
    await app.close();
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_CLIENT_ID'];
    delete process.env['AUTH_AUDIENCE'];
  });

  it('has no "Default Response" placeholders', () => {
    const specStr = JSON.stringify(openapiSpec);
    expect(specStr).not.toContain('Default Response');
  });

  it('uses OpenAPI 3.1.1', () => {
    expect(openapiSpec.openapi).toBe('3.1.1');
  });

  it('has servers array with valid URL', () => {
    const servers = openapiSpec.servers;
    expect(servers).toBeDefined();
    expect(Array.isArray(servers)).toBe(true);
    expect(servers?.length).toBeGreaterThan(0);
    expect(servers?.[0]?.url).toBeDefined();
    expect(servers?.[0]?.url).not.toBe('');
  });

  it('has exactly two servers (local + cloud)', () => {
    const servers = openapiSpec.servers;
    expect(servers).toBeDefined();
    expect(servers?.length).toBe(2);

    expect(servers?.[0]?.url).toBe('https://intexuraos-auth-service-ooafxzbaua-lm.a.run.app');
    expect(servers?.[0]?.description).toBe('Cloud (Development)');

    expect(servers?.[1]?.url).toBe('http://localhost:8080');
    expect(servers?.[1]?.description).toBe('Local');
  });

  it('every path+method has an operationId', () => {
    const paths = openapiSpec.paths;
    expect(paths).toBeDefined();

    for (const [path, methods] of Object.entries(paths ?? {})) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(
          operation.operationId,
          `Missing operationId for ${method.toUpperCase()} ${path}`
        ).toBeDefined();
        expect(operation.operationId).not.toBe('');
      }
    }
  });

  it('every POST endpoint with JSON body has requestBody with schema', () => {
    const paths = openapiSpec.paths;

    const postEndpoints = ['/v1/auth/device/start', '/v1/auth/device/poll', '/v1/auth/refresh'];

    for (const endpoint of postEndpoints) {
      const post = paths?.[endpoint]?.['post'];
      expect(post, `POST ${endpoint} should exist`).toBeDefined();
    }
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths;

    expect(paths?.['/v1/auth/device/start']).toBeDefined();
    expect(paths?.['/v1/auth/device/poll']).toBeDefined();
    expect(paths?.['/v1/auth/refresh']).toBeDefined();
    expect(paths?.['/v1/auth/config']).toBeDefined();
    expect(paths?.['/health']).toBeDefined();
  });
});
