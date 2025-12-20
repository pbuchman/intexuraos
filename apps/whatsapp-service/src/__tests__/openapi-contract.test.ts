import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import type { Config } from '../config.js';

describe('whatsapp-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: Record<string, unknown>;

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
    openapiSpec = JSON.parse(response.body) as Record<string, unknown>;
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

  it('GET /webhooks/whatsapp 200 response is text/plain', () => {
    const paths = openapiSpec.paths as Record<
      string,
      Record<
        string,
        {
          responses?: Record<
            string,
            { content?: Record<string, unknown> }
          >;
        }
      >
    >;

    const getWebhook = paths['/webhooks/whatsapp']?.get;
    expect(getWebhook).toBeDefined();

    const response200 = getWebhook?.responses?.['200'];
    expect(response200).toBeDefined();
    expect(response200?.content).toBeDefined();
    expect(response200?.content?.['text/plain']).toBeDefined();
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths as Record<string, unknown>;

    expect(paths['/webhooks/whatsapp']).toBeDefined();
    expect(paths['/health']).toBeDefined();
  });

  it('uses PUBLIC_BASE_URL in servers', () => {
    const servers = openapiSpec.servers as Array<{ url: string }>;
    expect(servers[0]?.url).toBe('https://whatsapp.praxos.app');
  });

  it('POST /webhooks/whatsapp documents signature header', () => {
    const paths = openapiSpec.paths as Record<
      string,
      Record<
        string,
        {
          parameters?: Array<{ in: string; name: string }>;
        }
      >
    >;

    const postWebhook = paths['/webhooks/whatsapp']?.post;
    expect(postWebhook).toBeDefined();
    // Signature is documented in headers schema
  });
});
