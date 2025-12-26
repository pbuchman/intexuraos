/**
 * OpenAPI contract tests for srt-service.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../server.js';
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

describe('srt-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: OpenApiSpec;

  const testConfig: Config = {
    speechmaticsApiKey: 'test-api-key',
    audioStoredSubscription: 'test-subscription',
    transcriptionCompletedTopic: 'test-transcription-completed',
    gcpProjectId: 'test-project',
    mediaBucketName: 'test-media-bucket',
    port: 8085,
    host: '0.0.0.0',
  };

  beforeAll(async () => {
    app = await createServer(testConfig);
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    openapiSpec = JSON.parse(response.body) as OpenApiSpec;
  });

  afterAll(async () => {
    await app.close();
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

    expect(servers?.[0]?.url).toBe('https://intexuraos-srt-service-cj44trunra-lm.a.run.app');
    expect(servers?.[0]?.description).toBe('Cloud (Development)');

    expect(servers?.[1]?.url).toBe('http://localhost:8085');
    expect(servers?.[1]?.description).toBe('Local');
  });

  it('every path+method has an operationId', () => {
    const paths = openapiSpec.paths;
    expect(paths).toBeDefined();

    for (const [_pathKey, methods] of Object.entries(paths ?? {})) {
      for (const [_method, spec] of Object.entries(methods)) {
        expect(spec.operationId).toBeDefined();
        expect(spec.operationId).not.toBe('');
        expect(spec.operationId).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/);
      }
    }
  });

  it('has transcription endpoints', () => {
    const paths = openapiSpec.paths;
    expect(paths).toBeDefined();
    expect(paths?.['/v1/transcribe']).toBeDefined();
    expect(paths?.['/v1/transcribe/{jobId}']).toBeDefined();
  });
});
