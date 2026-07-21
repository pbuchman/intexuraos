import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_INTEX_AGENT_MODEL, INTEX_AGENT_MODEL_OPTIONS } from '@intexuraos/llm-contract';
import { buildServer } from '../server.js';

interface OpenApiSpec {
  openapi?: string;
  servers?: { url: string; description?: string }[];
  paths?: Record<string, Record<string, { operationId?: string; requestBody?: unknown }>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

type SchemaObject = Record<string, unknown>;

function responseDataSchema(response: unknown): SchemaObject {
  const responseObject = response as {
    content?: { 'application/json'?: { schema?: { properties?: { data?: SchemaObject } } } };
  };
  const schema = responseObject.content?.['application/json']?.schema?.properties?.data;
  if (schema === undefined) {
    throw new Error('Response is missing its data schema');
  }
  return schema;
}

function projectionConsistencyBranches(schema: SchemaObject): readonly unknown[] {
  const allOf = schema['allOf'] as readonly SchemaObject[] | undefined;
  const branches = allOf?.[0]?.['oneOf'];
  if (!Array.isArray(branches)) {
    throw new Error('Available projection is missing cross-field consistency branches');
  }
  return branches;
}

describe('user-service OpenAPI contract', () => {
  let app: FastifyInstance;
  let openapiSpec: OpenApiSpec;

  beforeAll(async () => {
    // Set required env vars
    process.env['INTEXURAOS_AUTH0_DOMAIN'] = 'test.auth0.com';
    process.env['INTEXURAOS_AUTH0_CLIENT_ID'] = 'test-client';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.test.com';

    app = await buildServer();
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    openapiSpec = JSON.parse(response.body) as OpenApiSpec;
  });

  afterAll(async () => {
    await app.close();
    delete process.env['INTEXURAOS_AUTH0_DOMAIN'];
    delete process.env['INTEXURAOS_AUTH0_CLIENT_ID'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
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

    expect(servers?.[0]?.url).toBe('https://intexuraos-user-service-cj44trunra-lm.a.run.app');
    expect(servers?.[0]?.description).toBe('Cloud (Development)');

    expect(servers?.[1]?.url).toBe('http://localhost:8110');
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

    const postEndpoints = ['/auth/device/start', '/auth/device/poll', '/auth/refresh'];

    for (const endpoint of postEndpoints) {
      const post = paths?.[endpoint]?.['post'];
      expect(post, `POST ${endpoint} should exist`).toBeDefined();
    }
  });

  it('has required endpoints documented', () => {
    const paths = openapiSpec.paths;

    expect(paths?.['/auth/device/start']).toBeDefined();
    expect(paths?.['/auth/device/poll']).toBeDefined();
    expect(paths?.['/auth/refresh']).toBeDefined();
    expect(paths?.['/auth/config']).toBeDefined();
    expect(paths?.['/health']).toBeDefined();
  });

  it('documents the closed selector projections without a PATCH body schema', () => {
    const llmKeys = openapiSpec.paths?.['/users/{uid}/settings/llm-keys']?.['get'] as
      | { responses?: Record<string, unknown> }
      | undefined;
    const settingsPatch = openapiSpec.paths?.['/users/{uid}/settings']?.['patch'];
    const runtime = openapiSpec.paths?.['/internal/users/{uid}/settings/intex-agent-runtime']?.['get'] as
      | { responses?: Record<string, unknown> }
      | undefined;

    expect(settingsPatch?.requestBody).toBeUndefined();
    expect(llmKeys?.responses?.['200']).toBeDefined();
    expect(runtime?.responses?.['200']).toBeDefined();
  });

  it('documents Test Runs capability as an exact runtime-bound union', () => {
    const settingsOperation = openapiSpec.paths?.['/users/{uid}/settings']?.['get'] as {
      responses?: Record<string, unknown>;
    };
    const data = responseDataSchema(settingsOperation.responses?.['200']);
    const capabilities = (data['properties'] as SchemaObject)['intexAgentCapabilities'] as SchemaObject;
    const testRuns = (capabilities['properties'] as SchemaObject)['testRuns'] as SchemaObject;

    expect(testRuns['oneOf']).toEqual([
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['available'] },
          runtimeAudience: { type: 'string', enum: ['home-dev'] },
        },
        required: ['status', 'runtimeAudience'],
      },
      {
        type: 'object',
        additionalProperties: false,
        properties: { status: { type: 'string', enum: ['unavailable'] } },
        required: ['status'],
      },
    ]);
  });

  it('uses shared catalog tuple and matching explicit/effective/source branches in every selector response schema', () => {
    const llmKeysOperation = openapiSpec.paths?.['/users/{uid}/settings/llm-keys']?.['get'] as {
      responses?: Record<string, unknown>;
    };
    const settingsPatchOperation = openapiSpec.paths?.['/users/{uid}/settings']?.['patch'] as {
      responses?: Record<string, unknown>;
    };
    const runtimeOperation = openapiSpec.paths?.['/internal/users/{uid}/settings/intex-agent-runtime']?.['get'] as {
      responses?: Record<string, unknown>;
    };
    const llmData = responseDataSchema(llmKeysOperation.responses?.['200']);
    const selector = ((llmData['properties'] as SchemaObject)['intexAgentModelSelector'] as SchemaObject);
    const availableSelector = (selector['oneOf'] as SchemaObject[])[0] as SchemaObject;
    const selectorOptions = ((availableSelector['properties'] as SchemaObject)['options'] as SchemaObject);
    const tupleSchema = (selectorOptions['allOf'] as SchemaObject[])[0] as SchemaObject;

    expect(tupleSchema['items']).toEqual(
      INTEX_AGENT_MODEL_OPTIONS.map(({ id, label }) => ({ enum: [{ id, label }] }))
    );
    expect(tupleSchema['minItems']).toBe(INTEX_AGENT_MODEL_OPTIONS.length);
    expect(tupleSchema['maxItems']).toBe(INTEX_AGENT_MODEL_OPTIONS.length);
    expect(tupleSchema['additionalItems']).toBe(false);

    const expectedBranches = [
      {
        type: 'object',
        properties: {
          explicitModel: { enum: [null] },
          effectiveModel: { enum: [DEFAULT_INTEX_AGENT_MODEL] },
          source: { enum: ['default_absent'] },
        },
        required: ['explicitModel', 'effectiveModel', 'source'],
      },
      ...INTEX_AGENT_MODEL_OPTIONS.map(({ id }) => ({
        type: 'object',
        properties: {
          explicitModel: { enum: [id] },
          effectiveModel: { enum: [id] },
          source: { enum: ['explicit'] },
        },
        required: ['explicitModel', 'effectiveModel', 'source'],
      })),
    ];
    expect(projectionConsistencyBranches(availableSelector)).toEqual(expectedBranches);

    const patchData = responseDataSchema(settingsPatchOperation.responses?.['200']);
    const patchSelector = (patchData['oneOf'] as SchemaObject[])[1] as SchemaObject;
    expect(projectionConsistencyBranches(patchSelector)).toEqual(expectedBranches);

    const runtimeData = responseDataSchema(runtimeOperation.responses?.['200']);
    const runtimeAvailable = (runtimeData['oneOf'] as SchemaObject[])[0] as SchemaObject;
    const runtimeUnavailable = (runtimeData['oneOf'] as SchemaObject[])[1] as SchemaObject;
    expect(projectionConsistencyBranches(runtimeAvailable)).toEqual(expectedBranches);
    expect((runtimeUnavailable['properties'] as SchemaObject)['effectiveModel']).toEqual({
      enum: [DEFAULT_INTEX_AGENT_MODEL],
    });
  });
});
