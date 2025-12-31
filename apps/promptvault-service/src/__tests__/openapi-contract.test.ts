import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';

interface OpenApiSpec {
  openapi?: string;
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

describe('promptvault-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: OpenApiSpec;

  beforeAll(async () => {
    // Set required env vars
    process.env['AUTH_JWKS_URL'] = 'https://test.auth0.com/.well-known/jwks.json';
    process.env['AUTH_ISSUER'] = 'https://test.auth0.com/';
    process.env['AUTH_AUDIENCE'] = 'https://api.test.com';
    process.env['VITEST'] = 'true';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-auth-token';
    process.env['INTEXURAOS_NOTION_SERVICE_URL'] = 'http://localhost:3000';

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
    delete process.env['VITEST'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_NOTION_SERVICE_URL'];
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

  it('has exactly two servers (cloud + local)', () => {
    const servers = openapiSpec.servers;
    expect(servers).toBeDefined();
    expect(servers?.length).toBe(2);

    expect(servers?.[0]?.url).toBe(
      'https://intexuraos-promptvault-service-cj44trunra-lm.a.run.app'
    );
    expect(servers?.[0]?.description).toBe('Cloud (Development)');

    expect(servers?.[1]?.url).toBe('http://localhost:8111');
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

  it('bearerAuth description does NOT mention stub auth', () => {
    const bearerAuth = openapiSpec.components?.securitySchemes?.bearerAuth;
    expect(bearerAuth).toBeDefined();
    expect(bearerAuth?.description).toBeDefined();
    expect(bearerAuth?.description?.toLowerCase()).not.toContain('stub');
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths;

    // Prompt CRUD endpoints
    expect(paths?.['/prompt-vault/main-page']).toBeDefined();
    expect(paths?.['/prompt-vault/prompts']).toBeDefined();
    expect(paths?.['/prompt-vault/prompts/{prompt_id}']).toBeDefined();
    expect(paths?.['/health']).toBeDefined();

    // Integration and webhook endpoints moved to notion-service
    expect(paths?.['/notion/connect']).toBeUndefined();
    expect(paths?.['/notion/status']).toBeUndefined();
    expect(paths?.['/notion/disconnect']).toBeUndefined();
    expect(paths?.['/notion-webhooks']).toBeUndefined();
  });

  it('protected endpoints require bearerAuth security', () => {
    const paths = openapiSpec.paths;

    const protectedEndpoints = ['/prompt-vault/main-page', '/prompt-vault/prompts'];

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
});
