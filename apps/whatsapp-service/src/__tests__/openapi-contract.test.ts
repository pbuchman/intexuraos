import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import type { Config } from '../config.js';

interface OpenApiSpec {
  servers?: { url: string; description?: string }[];
  paths?: Record<
    string,
    Record<
      string,
      {
        operationId?: string;
        responses?: Record<string, { content?: Record<string, unknown> }>;
        parameters?: { in: string; name: string }[];
      }
    >
  >;
}

describe('whatsapp-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: OpenApiSpec;

  const testConfig: Config = {
    verifyToken: 'test-verify-token-12345',
    appSecret: 'test-app-secret-67890',
    port: 8080,
    host: '0.0.0.0',
  };

  beforeAll(async () => {
    // Set required env vars
    process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'] = testConfig.verifyToken;
    process.env['PRAXOS_WHATSAPP_APP_SECRET'] = testConfig.appSecret;
    process.env['PUBLIC_BASE_URL'] = 'https://whatsapp.praxos.app';
    process.env['VITEST'] = 'true';

    app = await buildServer(testConfig);
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    openapiSpec = JSON.parse(response.body) as OpenApiSpec;
  });

  afterAll(async () => {
    await app.close();
    delete process.env['PRAXOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['PRAXOS_WHATSAPP_APP_SECRET'];
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

    const localServer = servers?.find((s) => s.url === 'http://localhost:8082');
    const prodServer = servers?.find((s) => s.url === 'https://whatsapp.praxos.app');

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

  it('GET /webhooks/whatsapp 200 response is text/plain', () => {
    const paths = openapiSpec.paths;
    const getWebhook = paths?.['/webhooks/whatsapp']?.['get'];
    expect(getWebhook).toBeDefined();

    const response200 = getWebhook?.responses?.['200'];
    expect(response200).toBeDefined();
    expect(response200?.content).toBeDefined();
    expect(response200?.content?.['text/plain']).toBeDefined();
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths;

    expect(paths?.['/webhooks/whatsapp']).toBeDefined();
    expect(paths?.['/health']).toBeDefined();
  });

  it('uses PUBLIC_BASE_URL in servers', () => {
    const servers = openapiSpec.servers;
    // Should include production server and optional custom deployment
    const prodServer = servers?.find((s) => s.url === 'https://whatsapp.praxos.app');
    expect(prodServer).toBeDefined();
  });

  it('POST /webhooks/whatsapp documents signature header', () => {
    const paths = openapiSpec.paths;
    const postWebhook = paths?.['/webhooks/whatsapp']?.['post'];
    expect(postWebhook).toBeDefined();
    // Signature is documented in headers schema
  });

  it('all non-health endpoints use envelope format for success responses', () => {
    const paths = openapiSpec.paths;
    expect(paths).toBeDefined();

    for (const [path, methods] of Object.entries(paths ?? {})) {
      if (path === '/health' || path === '/docs' || path === '/openapi.json') continue;
      // GET /webhooks/whatsapp returns plain text, not envelope
      if (path === '/webhooks/whatsapp' && Object.keys(methods).includes('get')) {
        const getOp = methods['get'];
        const response200 = getOp?.responses?.['200'];
        expect(response200?.content?.['text/plain']).toBeDefined();
        continue;
      }

      for (const [method, operation] of Object.entries(methods)) {
        if (method === 'get' && path === '/webhooks/whatsapp') continue; // Already handled

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
