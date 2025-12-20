import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

interface OpenApiSpec {
  servers?: { url: string; description?: string }[];
  paths?: Record<
    string,
    Record<string, { operationId?: string; security?: Record<string, unknown[]>[] }>
  >;
  components?: {
    securitySchemes?: {
      bearerAuth?: { description?: string };
    };
  };
}

describe('notion-gpt-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: OpenApiSpec;

  beforeAll(async () => {
    // Set required env vars
    process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['AUTH_AUDIENCE'] = 'https://api.test.com';
    process.env['PUBLIC_BASE_URL'] = 'https://notion.praxos.app';
    process.env['VITEST'] = 'true';

    app = await buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    openapiSpec = JSON.parse(response.body) as OpenApiSpec;
  });

  afterAll(async () => {
    await app.close();
    delete process.env['AUTH_JWKS_URL'];
    delete process.env['AUTH_ISSUER'];
    delete process.env['AUTH_AUDIENCE'];
    delete process.env['PUBLIC_BASE_URL'];
    delete process.env['VITEST'];
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

    const localServer = servers?.find((s) => s.url === 'http://localhost:8081');
    const prodServer = servers?.find((s) => s.url === 'https://notion.praxos.app');

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

  it('bearerAuth description does NOT mention stub auth', () => {
    const bearerAuth = openapiSpec.components?.securitySchemes?.bearerAuth;
    expect(bearerAuth).toBeDefined();
    expect(bearerAuth?.description).toBeDefined();
    expect(bearerAuth?.description?.toLowerCase()).not.toContain('stub');
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths;

    expect(paths?.['/v1/integrations/notion/connect']).toBeDefined();
    expect(paths?.['/v1/integrations/notion/status']).toBeDefined();
    expect(paths?.['/v1/integrations/notion/disconnect']).toBeDefined();
    expect(paths?.['/v1/tools/notion/promptvault/main-page']).toBeDefined();
    expect(paths?.['/v1/tools/notion/promptvault/note']).toBeDefined();
    expect(paths?.['/v1/webhooks/notion']).toBeDefined();
    expect(paths?.['/health']).toBeDefined();
  });

  it('uses PUBLIC_BASE_URL in servers', () => {
    const servers = openapiSpec.servers;
    // Should include production server and optional custom deployment
    const prodServer = servers?.find((s) => s.url === 'https://notion.praxos.app');
    expect(prodServer).toBeDefined();
  });

  it('protected endpoints require bearerAuth security', () => {
    const paths = openapiSpec.paths;

    const protectedEndpoints = [
      '/v1/integrations/notion/connect',
      '/v1/integrations/notion/status',
      '/v1/integrations/notion/disconnect',
      '/v1/tools/notion/promptvault/main-page',
      '/v1/tools/notion/promptvault/note',
    ];

    for (const endpoint of protectedEndpoints) {
      const methods = paths?.[endpoint];
      expect(methods).toBeDefined();
      if (methods === undefined) continue;
      for (const [method, operation] of Object.entries(methods)) {
        if (method !== 'get' && method !== 'post') continue;
        expect(
          operation.security,
          `${method.toUpperCase()} ${endpoint} should have security`
        ).toBeDefined();
        const hasBearerAuth = operation.security?.some((s) => 'bearerAuth' in s);
        expect(hasBearerAuth, `${method.toUpperCase()} ${endpoint} should require bearerAuth`).toBe(
          true
        );
      }
    }
  });

  it('all non-health endpoints use envelope format for success responses', () => {
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
