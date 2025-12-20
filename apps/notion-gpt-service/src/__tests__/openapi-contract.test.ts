import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

describe('notion-gpt-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: Record<string, unknown>;

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
    openapiSpec = JSON.parse(response.body) as Record<string, unknown>;
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

  it('bearerAuth description does NOT mention stub auth', () => {
    const components = openapiSpec.components as {
      securitySchemes?: { bearerAuth?: { description?: string } };
    };
    const bearerAuth = components?.securitySchemes?.bearerAuth;
    expect(bearerAuth).toBeDefined();
    expect(bearerAuth?.description).toBeDefined();
    expect(bearerAuth?.description?.toLowerCase()).not.toContain('stub');
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths as Record<string, unknown>;

    expect(paths['/v1/integrations/notion/connect']).toBeDefined();
    expect(paths['/v1/integrations/notion/status']).toBeDefined();
    expect(paths['/v1/integrations/notion/disconnect']).toBeDefined();
    expect(paths['/v1/tools/notion/promptvault/main-page']).toBeDefined();
    expect(paths['/v1/tools/notion/promptvault/note']).toBeDefined();
    expect(paths['/v1/webhooks/notion']).toBeDefined();
    expect(paths['/health']).toBeDefined();
  });

  it('uses PUBLIC_BASE_URL in servers', () => {
    const servers = openapiSpec.servers as Array<{ url: string }>;
    expect(servers[0]?.url).toBe('https://notion.praxos.app');
  });

  it('protected endpoints require bearerAuth security', () => {
    const paths = openapiSpec.paths as Record<
      string,
      Record<string, { security?: Array<Record<string, unknown[]>> }>
    >;

    const protectedEndpoints = [
      '/v1/integrations/notion/connect',
      '/v1/integrations/notion/status',
      '/v1/integrations/notion/disconnect',
      '/v1/tools/notion/promptvault/main-page',
      '/v1/tools/notion/promptvault/note',
    ];

    for (const endpoint of protectedEndpoints) {
      const methods = paths[endpoint];
      expect(methods).toBeDefined();
      for (const [method, operation] of Object.entries(methods)) {
        if (method !== 'get' && method !== 'post') continue;
        expect(
          operation.security,
          `${method.toUpperCase()} ${endpoint} should have security`
        ).toBeDefined();
        const hasBearerAuth = operation.security?.some((s) => 'bearerAuth' in s);
        expect(hasBearerAuth, `${method.toUpperCase()} ${endpoint} should require bearerAuth`).toBe(true);
      }
    }
  });
});
