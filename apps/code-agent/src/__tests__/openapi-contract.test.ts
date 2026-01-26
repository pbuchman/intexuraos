/**
 * OpenAPI contract verification tests for code-agent service.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock jose library for JWT validation
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: { sub: 'test-user-id', email: 'test@example.com' },
  }),
}));

import { buildServer } from '../server.js';
import { resetServices, setServices } from '../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFirestoreCodeTaskRepository } from '../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../infra/repositories/firestoreLogChunkRepository.js';
import { createActionsAgentClient } from '../infra/clients/actionsAgentClient.js';
import type { CodeTaskRepository } from '../domain/repositories/codeTaskRepository.js';
import { createWorkerDiscoveryService } from '../infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from '../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../infra/services/whatsappNotifierImpl.js';
import type { WorkerDiscoveryService } from '../domain/services/workerDiscovery.js';
import type { TaskDispatcherService } from '../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../domain/repositories/logChunkRepository.js';
import type { ActionsAgentClient } from '../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';

describe('OpenAPI contract', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    // Set required env vars for worker discovery
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_AUTH0_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH0_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH0_JWKS_URI'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    const fakeFirestore = createFakeFirestore() as unknown as Firestore;
    setFirestore(fakeFirestore);
    const logger = pino({ name: 'test' }) as unknown as Logger;

    const rateLimitService: RateLimitService = {
      async checkLimits() {
        return ok(undefined);
      },
      async recordTaskStart() {
        return;
      },
      async recordTaskComplete() {
        return;
      },
    };

    setServices({
      firestore: fakeFirestore,
      logger,
      codeTaskRepo: createFirestoreCodeTaskRepository({
        firestore: fakeFirestore,
        logger,
      }),
      workerDiscovery: createWorkerDiscoveryService({ logger }),
      taskDispatcher: createTaskDispatcherService({
        logger,
        cfAccessClientId: 'test-client-id',
        cfAccessClientSecret: 'test-client-secret',
        dispatchSigningSecret: 'test-dispatch-secret',
        orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
        orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
      }),
      whatsappNotifier: createWhatsAppNotifier({
        baseUrl: 'http://whatsapp-service',
        internalAuthToken: 'test-token',
        logger,
      }),
      logChunkRepo: createFirestoreLogChunkRepository({
        firestore: fakeFirestore,
        logger,
      }),
      actionsAgentClient: createActionsAgentClient({
        baseUrl: 'http://actions-agent',
        internalAuthToken: 'test-token',
        logger,
      }),
      rateLimitService,
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      workerDiscovery: WorkerDiscoveryService;
      taskDispatcher: TaskDispatcherService;
      logChunkRepo: LogChunkRepository;
      actionsAgentClient: ActionsAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
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

    // Verify internal endpoints exist
    expect(schema.paths).toHaveProperty('/internal/code/process');
    expect(schema.paths).toHaveProperty('/internal/code-tasks/{taskId}');
    expect(schema.paths).toHaveProperty('/internal/code-tasks/linear/{linearIssueId}/active');
    expect(schema.paths).toHaveProperty('/internal/code-tasks/zombies');

    // Verify public endpoints exist
    expect(schema.paths).toHaveProperty('/code/tasks');
    expect(schema.paths).toHaveProperty('/code/tasks/{taskId}');
    expect(schema.paths).toHaveProperty('/code/cancel');

    // Verify HTTP methods
    expect(schema.paths['/internal/code/process']).toHaveProperty('post');
    expect(schema.paths['/internal/code-tasks/{taskId}']).toHaveProperty('patch');
    expect(schema.paths['/internal/code-tasks/linear/{linearIssueId}/active']).toHaveProperty('get');
    expect(schema.paths['/internal/code-tasks/zombies']).toHaveProperty('get');
    expect(schema.paths['/code/tasks']).toHaveProperty('get');
    expect(schema.paths['/code/tasks/{taskId}']).toHaveProperty('get');
    expect(schema.paths['/code/cancel']).toHaveProperty('post');
  });

  it('includes response schemas for all endpoints', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });

    expect(response.statusCode).toBe(200);

    const schema = JSON.parse(response.body);

    // Verify POST /internal/code/process responses
    const processPostEndpoint = schema.paths['/internal/code/process'].post;
    expect(processPostEndpoint.responses).toHaveProperty('200');
    expect(processPostEndpoint.responses).toHaveProperty('401');
    expect(processPostEndpoint.responses).toHaveProperty('409');
    expect(processPostEndpoint.responses).toHaveProperty('503');
    expect(processPostEndpoint.responses).toHaveProperty('500');

    // Verify GET /code/tasks/{taskId} responses
    const getByIdEndpoint = schema.paths['/code/tasks/{taskId}'].get;
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

    // Check that internal endpoints have 'internal' tag
    const processEndpoint = schema.paths['/internal/code/process'].post;
    expect(processEndpoint.tags).toContain('internal');

    // Check that public endpoints have 'public' tag
    const tasksListEndpoint = schema.paths['/code/tasks'].get;
    expect(tasksListEndpoint.tags).toContain('public');

    const cancelEndpoint = schema.paths['/code/cancel'].post;
    expect(cancelEndpoint.tags).toContain('public');

    // Check operation IDs
    expect(processEndpoint.operationId).toBe('processCodeAction');
    expect(schema.paths['/code/tasks/{taskId}'].get.operationId).toBe('getCodeTask');
    expect(schema.paths['/code/tasks'].get.operationId).toBe('listCodeTasks');
    expect(cancelEndpoint.operationId).toBe('cancelCodeTask');
  });
});
