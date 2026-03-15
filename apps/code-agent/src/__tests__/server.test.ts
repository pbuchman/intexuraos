/**
 * Tests for server configuration.
 */
import { Writable } from 'node:stream';
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
import { createFirestoreGitHubPRSummariesRepository } from '../infra/firestore/gitHubPRSummariesRepository.js';
import { createFirestoreTurnMetricsRepository } from '../infra/repositories/firestoreTurnMetricsRepository.js';

describe('server configuration', () => {
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
      taskDispatcher: createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe }),
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
      gitHubPRSummaryRepo: createFirestoreGitHubPRSummariesRepository({
        logger,
      }),
      turnMetricsRepo: createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: {} as never,
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
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../domain/ports/automationLog.js').AutomationLog;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
  });

  it('configures requestTimeout to 120 seconds', () => {
    // Fastify exposes the server's requestTimeout via the underlying http.Server
    const httpServer = app.server;
    expect(httpServer.requestTimeout).toBe(120000);
  });

  it('provides a functional request.log when loggerStream is supplied', async () => {
    const chunks: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _encoding: string, callback: () => void): void {
        chunks.push(chunk.toString());
        callback();
      },
    });

    const appWithLogger = await buildServer(logStream);

    // Trigger a request — the onRequest hook in intexuraFastifyPlugin adds requestId,
    // and if Fastify has a real logger, request.log will write to our stream.
    // We add a route that explicitly logs via request.log to verify it works.
    appWithLogger.get('/test-log', async (request, reply) => {
      request.log.error({ test: true }, 'test-log-message');
      return await reply.ok({ logged: true });
    });

    await appWithLogger.inject({ method: 'GET', url: '/test-log' });

    const output = chunks.join('');
    expect(output).toContain('test-log-message');

    await appWithLogger.close();
  });

  it('serves health endpoint correctly with timeout configured', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('code-agent');
  });
});
