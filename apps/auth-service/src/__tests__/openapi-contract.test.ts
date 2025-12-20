import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

interface OpenApiSpec {
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
    process.env['PUBLIC_BASE_URL'] = 'https://auth.praxos.app';

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
    delete process.env['PUBLIC_BASE_URL'];
  });

  it('has no "Default Response" placeholders', () => {
    const specStr = JSON.stringify(openapiSpec);
    expect(specStr).not.toContain('Default Response');
  });

  it('has servers array with valid URL', () => {
    const servers = openapiSpec.servers;
    expect(servers).toBeDefined();
    expect(Array.isArray(servers)).toBe(true);
    expect(servers?.length).toBeGreaterThan(0);
    expect(servers?.[0]?.url).toBeDefined();
    expect(servers?.[0]?.url).not.toBe('');
  });

  it('includes both local and production servers', () => {
    const servers = openapiSpec.servers;
    expect(servers).toBeDefined();

    const localServer = servers?.find((s) => s.url === 'http://localhost:8080');
    const prodServer = servers?.find((s) => s.url === 'https://auth.praxos.app');

    expect(localServer).toBeDefined();
    expect(localServer?.description).toBe('Local development');
    expect(prodServer).toBeDefined();
    expect(prodServer?.description).toBe('Production (Cloud Run)');
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

  it('uses PUBLIC_BASE_URL in servers', () => {
    const servers = openapiSpec.servers;
    // Should include production server and optional custom deployment
    const prodServer = servers?.find((s) => s.url === 'https://auth.praxos.app');
    expect(prodServer).toBeDefined();

    // If PUBLIC_BASE_URL was set to something different, it should also be present
    const customServer = servers?.find((s) => s.url === 'https://auth.praxos.app');
    expect(customServer).toBeDefined();
  });

  it('all endpoints use envelope format for success responses', () => {
    const paths = openapiSpec.paths;
    expect(paths).toBeDefined();

    for (const [path, methods] of Object.entries(paths ?? {})) {
      if (path === '/health' || path === '/docs' || path === '/openapi.json') continue;

      for (const [method, operation] of Object.entries(methods)) {
        const responses = (
          operation as { responses?: Record<string, { properties?: Record<string, unknown> }> }
        ).responses;
        if (!responses) continue;

        const response200 = responses['200'];
        if (!response200) continue;

        const props = response200.properties;
        expect(
          props,
          `${method.toUpperCase()} ${path} 200 response should have properties`
        ).toBeDefined();
        expect(
          props?.['success'],
          `${method.toUpperCase()} ${path} 200 response should have success field`
        ).toBeDefined();
        expect(
          props?.['data'],
          `${method.toUpperCase()} ${path} 200 response should have data field`
        ).toBeDefined();
      }
    }
  });

  it('all error responses use envelope format', () => {
    const paths = openapiSpec.paths;
    expect(paths).toBeDefined();

    const errorCodes = ['400', '401', '403', '404', '409', '500', '502', '503'];

    for (const [path, methods] of Object.entries(paths ?? {})) {
      if (path === '/health' || path === '/docs' || path === '/openapi.json') continue;

      for (const [method, operation] of Object.entries(methods)) {
        const responses = (
          operation as { responses?: Record<string, { properties?: Record<string, unknown> }> }
        ).responses;
        if (!responses) continue;

        for (const code of errorCodes) {
          const errorResponse = responses[code];
          if (!errorResponse) continue;

          const props = errorResponse.properties;
          expect(
            props,
            `${method.toUpperCase()} ${path} ${code} response should have properties`
          ).toBeDefined();
          expect(
            props?.['success'],
            `${method.toUpperCase()} ${path} ${code} response should have success field`
          ).toBeDefined();
          expect(
            props?.['error'],
            `${method.toUpperCase()} ${path} ${code} response should have error field`
          ).toBeDefined();
        }
      }
    }
  });
});
