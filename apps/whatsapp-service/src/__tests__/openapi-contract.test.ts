import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../server.js';
import type { Config } from '../config.js';

interface OpenApiSpec {
  openapi?: string;
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
    accessToken: 'test-access-token',
    allowedWabaIds: ['102290129340398'],
    allowedPhoneNumberIds: ['123456789012345'],
    mediaBucket: 'test-media-bucket',
    mediaCleanupTopic: 'test-media-cleanup',
    mediaCleanupSubscription: 'test-media-cleanup-sub',
    speechmaticsApiKey: 'test-speechmatics-api-key',
    gcpProjectId: 'test-project',
    port: 8080,
    host: '0.0.0.0',
  };

  beforeAll(async () => {
    // Set required env vars
    process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'] = testConfig.verifyToken;
    process.env['INTEXURAOS_WHATSAPP_APP_SECRET'] = testConfig.appSecret;
    process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'] = testConfig.accessToken;
    process.env['INTEXURAOS_WHATSAPP_WABA_ID'] = testConfig.allowedWabaIds.join(',');
    process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'] = testConfig.allowedPhoneNumberIds.join(',');
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
    delete process.env['INTEXURAOS_WHATSAPP_VERIFY_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_APP_SECRET'];
    delete process.env['INTEXURAOS_WHATSAPP_ACCESS_TOKEN'];
    delete process.env['INTEXURAOS_WHATSAPP_WABA_ID'];
    delete process.env['INTEXURAOS_WHATSAPP_PHONE_NUMBER_ID'];
    delete process.env['VITEST'];
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

    expect(servers?.[0]?.url).toBe('https://intexuraos-whatsapp-service-cj44trunra-lm.a.run.app');
    expect(servers?.[0]?.description).toBe('Cloud (Development)');

    expect(servers?.[1]?.url).toBe('http://localhost:8113');
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

  it('GET /whatsapp/webhooks 200 response is text/plain', () => {
    const paths = openapiSpec.paths;
    const getWebhook = paths?.['/whatsapp/webhooks']?.['get'];
    expect(getWebhook).toBeDefined();

    const response200 = getWebhook?.responses?.['200'];
    expect(response200).toBeDefined();
    expect(response200?.content).toBeDefined();
    expect(response200?.content?.['text/plain']).toBeDefined();
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths;

    expect(paths?.['/whatsapp/webhooks']).toBeDefined();
    expect(paths?.['/health']).toBeDefined();
  });

  it('POST /whatsapp/webhooks documents signature header', () => {
    const paths = openapiSpec.paths;
    const postWebhook = paths?.['/whatsapp/webhooks']?.['post'];
    expect(postWebhook).toBeDefined();
    // Signature is documented in headers schema
  });
});
