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
import { createFirestoreLogLineRepository } from '../infra/repositories/firestoreLogLineRepository.js';
import { createActionsAgentClient } from '../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../domain/services/linearIssueService.js';
import type { CodeTaskRepository } from '../domain/repositories/codeTaskRepository.js';
import { createTaskDispatcherService } from '../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../infra/services/whatsappNotifierImpl.js';
import { createStatusMirrorService } from '../infra/services/statusMirrorServiceImpl.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { ok } from '@intexuraos/common-core';
import type { TaskDispatcherService } from '../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../domain/repositories/logLineRepository.js';
import type { ActionsAgentClient } from '../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../domain/services/rateLimitService.js';
import type { LinearIssueService } from '../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../domain/ports/linearAgentClient.js';
import type { StatusMirrorService } from '../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient, type MetricsClient } from '../infra/metrics.js';
import { createWorkerSettingsRepository } from '../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from './helpers/mockServices.js';
import { createFirestoreGitHubPREventsRepository } from '../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../infra/repositories/firestoreTurnMetricsRepository.js';

describe('OpenAPI contract', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    // Set required env vars
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    const fakeFirestore = createFakeFirestore() as unknown as Firestore;
    setFirestore(fakeFirestore);
    const logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

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

    const actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore,
      logger,
    });

    const workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore,
      logger,
    });

    setServices({
      firestore: fakeFirestore,
      logger,
      codeTaskRepo,
      taskDispatcher: createTaskDispatcherService({ logger }),
      workerSettingsRepo,
      whatsappNotifier: createWhatsAppNotifier({
        whatsappPublisher: {
          publishSendMessage: async () => ok(undefined),
        } as unknown as WhatsAppSendPublisher,
      }),
      logChunkRepo: createFirestoreLogChunkRepository({
        firestore: fakeFirestore,
        logger,
      }),
      logLineRepo: createFirestoreLogLineRepository({
        firestore: fakeFirestore,
        logger,
      }),
      actionsAgentClient,
      linearAgentClient: createLinearAgentHttpClient({
        baseUrl: 'http://linear-agent:8086',
        internalAuthToken: 'test-token',
        timeoutMs: 10000,
      }, logger),
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient,
        logger,
      }),
      processHeartbeat: createProcessHeartbeatUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
      }),
      detectZombieTasks: createDetectZombieTasksUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
        firestore: fakeFirestore,
      }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({
        codeTaskRepository: codeTaskRepo,
        logger,
      }),
      linearIssueService: createLinearIssueService({
        linearAgentClient: createLinearAgentHttpClient({
          baseUrl: 'http://linear-agent:8086',
          internalAuthToken: 'test-token',
          timeoutMs: 10000,
        }, logger),
        logger,
      }),
      metricsClient: createNoOpMetricsClient(),
      rateLimitService,
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo: createFirestoreGitHubPREventsRepository({
        logger,
      }),
      gitHubPRSummaryRepo: {} as never,
      turnMetricsRepo: createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      taskDispatcher: TaskDispatcherService;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      actionsAgentClient: ActionsAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      linearAgentClient: LinearAgentClient;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      workerSettingsRepo: WorkerSettingsRepository;
      processHeartbeat: import('../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../domain/services/gitHubDispatchService.js').WebhookDispatchService;
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
