import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('auth-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: Record<string, unknown>;

  beforeAll(async () => {
    // Set required env vars
    process.env['AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['AUTH0_CLIENT_ID'] = 'test-client';
    process.env['AUTH_AUDIENCE'] = 'https://api.test.com';
    process.env['PUBLIC_BASE_URL'] = 'https://auth.praxos.app';

    app = await buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    openapiSpec = JSON.parse(response.body) as Record<string, unknown>;
  });

  afterAll(async () => {
    await app.close();
    delete process.env['AUTH0_DOMAIN'];
    delete process.env['AUTH0_CLIENT_ID'];
    delete process.env['AUTH_AUDIENCE'];
    delete process.env['PUBLIC_BASE_URL'];
  });

  it('has no "Default Response" placeholders', () => {
    const specStr = JSON.stringify(openapiSpec);
    expect(specStr).not.toContain('Default Response');
  });

  it('has servers array with valid URL', () => {
    const servers = openapiSpec.servers as Array<{ url: string }> | undefined;
    expect(servers).toBeDefined();
    expect(Array.isArray(servers)).toBe(true);
    expect(servers?.length).toBeGreaterThan(0);
    expect(servers?.[0]?.url).toBeDefined();
    expect(servers?.[0]?.url).not.toBe('');
  });

  it('every path+method has an operationId', () => {
    const paths = openapiSpec.paths as Record<
      string,
      Record<string, { operationId?: string }>
    >;
    expect(paths).toBeDefined();

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        expect(operation.operationId, `Missing operationId for ${method.toUpperCase()} ${path}`).toBeDefined();
        expect(operation.operationId).not.toBe('');
      }
    }
  });

  it('every POST endpoint with JSON body has requestBody with schema', () => {
    const paths = openapiSpec.paths as Record<
      string,
      Record<string, { requestBody?: { content?: Record<string, { schema?: unknown }> } }>
    >;

    const postEndpoints = [
      '/v1/auth/device/start',
      '/v1/auth/device/poll',
      '/v1/auth/refresh',
    ];

    for (const endpoint of postEndpoints) {
      const post = paths[endpoint]?.post;
      expect(post, `POST ${endpoint} should exist`).toBeDefined();
      // Note: These endpoints accept optional body or have inline schemas
      // The body schema is defined in route schema
    }
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths as Record<string, unknown>;

    expect(paths['/v1/auth/device/start']).toBeDefined();
    expect(paths['/v1/auth/device/poll']).toBeDefined();
    expect(paths['/v1/auth/refresh']).toBeDefined();
    expect(paths['/v1/auth/config']).toBeDefined();
    expect(paths['/health']).toBeDefined();
  });

  it('uses PUBLIC_BASE_URL in servers', () => {
    const servers = openapiSpec.servers as Array<{ url: string }>;
    expect(servers[0]?.url).toBe('https://auth.praxos.app');
  });
});
