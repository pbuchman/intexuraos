/**
 * OpenAPI contract verification tests for code-agent service.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFirestoreCodeTaskRepository } from '../infra/repositories/firestoreCodeTaskRepository.js';
import type { CodeTaskRepository } from '../domain/repositories/codeTaskRepository.js';

describe('OpenAPI contract', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    const fakeFirestore = createFakeFirestore() as unknown as Firestore;
    setFirestore(fakeFirestore);
    const logger = pino({ name: 'test' }) as unknown as Logger;

    setServices({
      firestore: fakeFirestore,
      logger,
      codeTaskRepo: createFirestoreCodeTaskRepository({
        firestore: fakeFirestore,
        logger,
      }),
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
  });

  it('generates valid OpenAPI schema', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);

    const schema = JSON.parse(response.body);

    // Verify OpenAPI structure
    expect(schema).toHaveProperty('openapi');
    expect(schema).toHaveProperty('info');
    expect(schema).toHaveProperty('paths');
    // Note: tags are endpoint-level, not global in Fastify Swagger

    // Verify info object
    expect(schema.info.title).toBe('code-agent API');
    expect(schema.info.version).toBeDefined();
  });

  it('includes all code-agent endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);

    const schema = JSON.parse(response.body);

    // Verify core endpoints exist
    expect(schema.paths).toHaveProperty('/internal/code-tasks');
    expect(schema.paths).toHaveProperty('/internal/code-tasks/{taskId}');
    expect(schema.paths).toHaveProperty('/internal/code-tasks/linear/{linearIssueId}/active');
    expect(schema.paths).toHaveProperty('/internal/code-tasks/zombies');

    // Verify HTTP methods
    expect(schema.paths['/internal/code-tasks']).toHaveProperty('post');
    expect(schema.paths['/internal/code-tasks/{taskId}']).toHaveProperty('get');
    expect(schema.paths['/internal/code-tasks']).toHaveProperty('get'); // list endpoint
    expect(schema.paths['/internal/code-tasks/{taskId}']).toHaveProperty('patch');
  });

  it('includes response schemas for all endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);

    const schema = JSON.parse(response.body);

    // Verify POST /internal/code-tasks responses
    const postEndpoint = schema.paths['/internal/code-tasks'].post;
    expect(postEndpoint.responses).toHaveProperty('201');
    expect(postEndpoint.responses).toHaveProperty('409');

    // Verify GET /internal/code-tasks/{taskId} responses
    const getByIdEndpoint = schema.paths['/internal/code-tasks/{taskId}'].get;
    expect(getByIdEndpoint.responses).toHaveProperty('200');
    expect(getByIdEndpoint.responses).toHaveProperty('404');

    // Verify PATCH /internal/code-tasks/{taskId} responses
    const patchEndpoint = schema.paths['/internal/code-tasks/{taskId}'].patch;
    expect(patchEndpoint.responses).toHaveProperty('200');
    expect(patchEndpoint.responses).toHaveProperty('404');
  });

  it('tags endpoints correctly', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);

    const schema = JSON.parse(response.body);

    // Check that endpoints have tags
    const postEndpoint = schema.paths['/internal/code-tasks'].post;
    expect(postEndpoint.tags).toContain('internal');

    // Check operation IDs
    expect(postEndpoint.operationId).toBe('createCodeTask');
    expect(schema.paths['/internal/code-tasks/{taskId}'].get.operationId).toBe('getCodeTask');
    expect(schema.paths['/internal/code-tasks'].get.operationId).toBe('listCodeTasks');
  });
});
