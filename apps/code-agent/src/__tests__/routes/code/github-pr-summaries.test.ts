/**
 * Tests for GET /code/github-pr-summaries endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../../server.js';
import { resetServices, setServices } from '../../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from 'pino';
import { ok, err } from '@intexuraos/common-core';
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreGitHubPRSummariesRepository } from '../../../infra/firestore/gitHubPRSummariesRepository.js';
import type { GitHubPRSummaryRepository } from '../../../domain/repositories/gitHubPRSummaryRepository.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../../helpers/mockServices.js';
import { createFirestoreCodeTaskRepository } from '../../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../../infra/repositories/firestoreLogLineRepository.js';
import { createWhatsAppNotifier } from '../../../infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient } from '../../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../../infra/http/linearAgentHttpClient.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import { createLinearIssueService } from '../../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import type { TaskDispatcherService, DispatchResult } from '../../../domain/services/taskDispatcher.js';
import type { RateLimitService } from '../../../domain/services/rateLimitService.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createFirestoreTurnMetricsRepository } from '../../../infra/repositories/firestoreTurnMetricsRepository.js';

describe('GET /code/github-pr-summaries', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    nock('http://actions-agent')
      .persist()
      .patch(/\/internal\/actions\/.*\/status/)
      .reply(200, { success: true });

    nock('http://linear-agent:8086')
      .persist()
      .post(/\/.*/)
      .reply(200, { success: true });

    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const taskDispatcher: TaskDispatcherService = {
      async dispatch(): Promise<ReturnType<typeof ok<DispatchResult>>> {
        return ok({ dispatched: true, workerLocation: 'mac' });
      },
      async cancelOnWorker(): Promise<void> {
        return;
      },
      async sendMessageToWorker(): Promise<ReturnType<typeof ok<{ action: 'queued' | 'resumed' }>>> {
        return ok({ action: 'queued' as const });
      },
    };

    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    });

    const logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const logLineRepo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

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

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    const gitHubPREventRepo = createFirestoreGitHubPREventsRepository({ logger });
    const gitHubPRSummaryRepo = createFirestoreGitHubPRSummariesRepository({ logger });

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher,
      whatsappNotifier,
      logChunkRepo,
      logLineRepo,
      actionsAgentClient,
      linearAgentClient,
      rateLimitService,
      linearIssueService,
      metricsClient: createNoOpMetricsClient(),
      statusMirrorService: createStatusMirrorService({ actionsAgentClient, logger }),
      processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      workerSettingsRepo: createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo,
      gitHubPRSummaryRepo,
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
      taskEnqueueService: {} as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue({ attempted: 0 }),
      },
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: typeof codeTaskRepo;
      taskDispatcher: TaskDispatcherService;
      logChunkRepo: typeof logChunkRepo;
      logLineRepo: typeof logLineRepo;
      actionsAgentClient: typeof actionsAgentClient;
      linearAgentClient: LinearAgentClient;
      whatsappNotifier: ReturnType<typeof createWhatsAppNotifier>;
      rateLimitService: RateLimitService;
      linearIssueService: ReturnType<typeof createLinearIssueService>;
      statusMirrorService: ReturnType<typeof createStatusMirrorService>;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      workerSettingsRepo: ReturnType<typeof createWorkerSettingsRepository>;
      workerHealthProbe: import('../../../domain/ports/workerHealthProbe.js').WorkerHealthProbe;
      gitHubPREventRepo: import('../../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
    });

    server = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  it('should return 401 without auth token', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-summaries',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 200 with empty array when no summaries exist', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-summaries',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.prs).toEqual([]);
  });

  it('should return summaries with correct status derivation', async () => {
    const { gitHubPRSummaryRepo } = (await import('../../../services.js')).getServices();

    const now = new Date();
    const daysAgo = (n: number): Date => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

    // Upsert three PRs with different states (all within last 30 days)
    await gitHubPRSummaryRepo.upsert({
      repository: 'intexuraos/repo',
      pullRequestNumber: 10,
      lastActivityAt: daysAgo(3),
      firstSeenAt: daysAgo(3),
      title: 'Open PR',
      state: 'open',
      mergedAt: null,
    });

    await gitHubPRSummaryRepo.upsert({
      repository: 'intexuraos/repo',
      pullRequestNumber: 20,
      lastActivityAt: daysAgo(5),
      firstSeenAt: daysAgo(5),
      title: 'Closed PR',
      state: 'closed',
      mergedAt: null,
    });

    await gitHubPRSummaryRepo.upsert({
      repository: 'intexuraos/repo',
      pullRequestNumber: 30,
      lastActivityAt: daysAgo(7),
      firstSeenAt: daysAgo(7),
      title: 'Merged PR',
      state: 'closed',
      mergedAt: daysAgo(7),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-summaries',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    const prs = body.data.prs as { pullRequestNumber: number; status: string }[];

    const pr10 = prs.find((p) => p.pullRequestNumber === 10);
    const pr20 = prs.find((p) => p.pullRequestNumber === 20);
    const pr30 = prs.find((p) => p.pullRequestNumber === 30);

    expect(pr10?.status).toBe('open');
    expect(pr20?.status).toBe('closed');
    expect(pr30?.status).toBe('merged');
  });

  it('should return summaries sorted by PR number descending', async () => {
    const { gitHubPRSummaryRepo } = (await import('../../../services.js')).getServices();

    const now = new Date();
    const daysAgo = (n: number): Date => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

    await gitHubPRSummaryRepo.upsert({
      repository: 'intexuraos/repo',
      pullRequestNumber: 5,
      lastActivityAt: daysAgo(3),
      firstSeenAt: daysAgo(3),
    });

    await gitHubPRSummaryRepo.upsert({
      repository: 'intexuraos/repo',
      pullRequestNumber: 15,
      lastActivityAt: daysAgo(5),
      firstSeenAt: daysAgo(5),
    });

    await gitHubPRSummaryRepo.upsert({
      repository: 'intexuraos/repo',
      pullRequestNumber: 10,
      lastActivityAt: daysAgo(7),
      firstSeenAt: daysAgo(7),
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-summaries',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const prNumbers = (body.data.prs as { pullRequestNumber: number }[]).map((p) => p.pullRequestNumber);

    expect(prNumbers).toEqual([15, 10, 5]);
  });

  it('should return 500 when findRecentlyActive returns an error', async () => {
    const { getServices } = await import('../../../services.js');
    const services = getServices();

    const failingRepo: GitHubPRSummaryRepository = {
      ...services.gitHubPRSummaryRepo,
      async findRecentlyActive() {
        return err({ code: 'FIRESTORE_ERROR', message: 'Firestore connection failed' });
      },
    };

    services.gitHubPRSummaryRepo = failingRepo;

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-summaries',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Failed to fetch PR summaries');
  });
});
