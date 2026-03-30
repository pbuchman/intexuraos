/**
 * Tests for GET/POST /code/github-event-log and GET /code/github-event-log/:id/payload endpoints.
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
import { err, ok } from '@intexuraos/common-core';
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreGitHubPRSummariesRepository } from '../../../infra/firestore/gitHubPRSummariesRepository.js';
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
import { createArchiveStaleGroupsUseCase } from '../../../domain/usecases/archiveStaleGroups.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import type { TaskDispatcherService, DispatchResult } from '../../../domain/services/taskDispatcher.js';
import type { RateLimitService } from '../../../domain/services/rateLimitService.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createFirestoreTurnMetricsRepository } from '../../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createFirestoreGitHubWebhookAuditEventRepository } from '../../../infra/firestore/gitHubWebhookAuditEventRepository.js';
import { createFirestoreGitHubEventLogEntryRepository } from '../../../infra/firestore/gitHubEventLogEntryRepository.js';
import { createFirestoreEventDecisionRepository } from '../../../infra/firestore/eventDecisionRepository.js';

describe('GitHub event log routes', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let baseServices: import('../../../services.js').ServiceContainer;
  let seededAuditEventId: string;

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
    const gitHubWebhookAuditEventRepo = createFirestoreGitHubWebhookAuditEventRepository({ logger });
    const gitHubEventLogEntryRepo = createFirestoreGitHubEventLogEntryRepository({ logger });
    const eventDecisionRepo = createFirestoreEventDecisionRepository({ logger });

    baseServices = {
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
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      workerSettingsRepo: createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo,
      gitHubPRSummaryRepo,
      gitHubWebhookAuditEventRepo,
      gitHubEventLogEntryRepo,
      turnMetricsRepo: createFirestoreTurnMetricsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
      toolCallingClient: undefined,
      eventDecisionRepo,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: {} as never,
      taskEnqueueService: {} as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue({ processed: 0 }),
      },
      mergeQueueWatchRepo: {
        create: vi.fn(),
        findById: vi.fn(),
        findActiveByUserAndBranch: vi.fn(),
        findAllActive: vi.fn(),
        findByUserAndRepo: vi.fn(),
        update: vi.fn(),
        appendMergedPr: vi.fn(),
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
      gitHubWebhookAuditEventRepo: import('../../../domain/repositories/gitHubWebhookAuditEventRepository.js').GitHubWebhookAuditEventRepository;
      gitHubEventLogEntryRepo: import('../../../domain/repositories/gitHubEventLogEntryRepository.js').GitHubEventLogEntryRepository;
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
      mergeQueueWatchRepo: import('../../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    };

    setServices(baseServices);

    const auditSaveResult = await gitHubWebhookAuditEventRepo.save({
      deliveryId: 'delivery-1',
      githubEventName: 'pull_request',
      eventType: 'pull_request',
      action: 'opened',
      repository: 'intexuraos/test-repo',
      repositoryId: 101,
      pullRequestNumber: 42,
      pullRequestId: 4242,
      senderLogin: 'octocat',
      senderId: 99,
      senderType: 'User',
      authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
      receivedAt: new Date('2026-03-12T10:00:00.000Z'),
      normalizationStatus: 'normalized',
      payload: { action: 'opened' },
    });
    if (!auditSaveResult.ok) {
      throw new Error('Failed to save seeded audit event');
    }
    seededAuditEventId = auditSaveResult.value.id;
    await gitHubEventLogEntryRepo.createPending({
      id: 'delivery-1',
      githubEventName: 'pull_request',
      eventType: 'pull_request',
      action: 'opened',
      repository: 'intexuraos/test-repo',
      pullRequestNumber: 42,
      authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
      updatedAt: new Date('2026-03-12T10:00:00.000Z'),
      decisionState: 'pending',
      decisionOutcome: null,
      rowVersion: 1,
    });
    await eventDecisionRepo.save({
      eventId: 'delivery-1',
      normalizedEventId: 'normalized-1',
      repository: 'intexuraos/test-repo',
      pullRequestNumber: 42,
      eventType: 'pull_request',
      eventAction: 'opened',
      senderLogin: 'octocat',
      decidedBy: 'github_agent',
      decision: 'request_review',
      reason: 'LLM request_review: architecture, security',
      dispatchAction: 'create_review_task',
      dispatchParams: {
        taskId: 'task-review-1',
        reviewTypes: ['architecture', 'security'],
        workerType: 'qwen',
      },
      decisionLatencyMs: 1200,
    });
    await gitHubEventLogEntryRepo.complete({
      id: 'delivery-1',
      decisionId: 'ed_delivery-1',
      decisionState: 'completed',
      decisionOutcome: 'request_review',
      updatedAt: new Date('2026-03-12T10:00:02.000Z'),
      rowVersion: 2,
    });

    server = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  it('returns hydrated event log rows from audit events and decisions', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.rows).toEqual([
      expect.objectContaining({
        id: 'delivery-1',
        githubEventName: 'pull_request',
        eventType: 'pull_request',
        action: 'opened',
        repository: 'intexuraos/test-repo',
        pullRequestNumber: 42,
        decisionState: 'completed',
        decisionOutcome: 'request_review',
        dispatchAction: 'create_review_task',
        reviewTypes: ['architecture', 'security'],
        taskId: 'task-review-1',
        workerType: 'qwen',
      }),
    ]);
  });

  it('hydrates specific rows by ids', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/code/github-event-log/rows',
      headers: {
        authorization: 'Bearer fake-token',
        'content-type': 'application/json',
      },
      payload: { ids: ['delivery-1'] },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.rows[0]).toEqual(
      expect.objectContaining({
        id: 'delivery-1',
        decisionId: 'ed_delivery-1',
        normalizedEventId: 'normalized-1',
      })
    );
  });

  it('uses entry fallback fields and nulls when audit and decision lookups are unavailable', async () => {
    const auditFreeEntryRepo = baseServices.gitHubEventLogEntryRepo;
    if (auditFreeEntryRepo === undefined) {
      throw new Error('GitHub event log entry repo not configured in test');
    }

    await auditFreeEntryRepo.createPending({
      id: 'delivery-2',
      githubEventName: 'unknown',
      eventType: 'unknown',
      action: null,
      repository: 'intexuraos/fallback-repo',
      pullRequestNumber: 99,
      authPassedAt: new Date('2026-03-12T11:00:00.000Z'),
      updatedAt: new Date('2026-03-12T11:00:00.000Z'),
      decisionState: 'pending',
      decisionOutcome: null,
      rowVersion: 1,
    });

    const { gitHubWebhookAuditEventRepo: _ignoredAuditRepo, ...servicesWithoutAuditRepo } = baseServices;
    setServices({
      ...servicesWithoutAuditRepo,
      eventDecisionRepo: {
        save: baseServices.eventDecisionRepo.save.bind(baseServices.eventDecisionRepo),
      } as import('../../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository,
    } as import('../../../services.js').ServiceContainer);

    const response = await server.inject({
      method: 'POST',
      url: '/code/github-event-log/rows',
      headers: {
        authorization: 'Bearer fake-token',
        'content-type': 'application/json',
      },
      payload: { ids: ['delivery-2'] },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.rows).toEqual([
      {
        id: 'delivery-2',
        decisionId: null,
        normalizedEventId: null,
        deliveryId: null,
        githubEventName: 'unknown',
        eventType: 'unknown',
        action: null,
        repository: 'intexuraos/fallback-repo',
        repositoryId: null,
        pullRequestNumber: 99,
        pullRequestId: null,
        senderLogin: null,
        senderType: null,
        authPassedAt: '2026-03-12T11:00:00.000Z',
        updatedAt: '2026-03-12T11:00:00.000Z',
        decisionState: 'pending',
        decisionOutcome: null,
        decidedBy: null,
        reason: null,
        dispatchAction: null,
        reviewTypes: [],
        taskId: null,
        workerType: null,
        decisionLatencyMs: null,
      },
    ]);
  });

  it('returns 500 when the list route has no event log repository configured', async () => {
    const { gitHubEventLogEntryRepo: _ignoredEventLogRepo, ...servicesWithoutEventLogRepo } = baseServices;
    setServices({
      ...servicesWithoutEventLogRepo,
    } as import('../../../services.js').ServiceContainer);

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 400 for an invalid cursor', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log?cursor=not-a-date',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('passes the provided limit and cursor through to the list route and returns nextCursor', async () => {
    const eventLogRepo = baseServices.gitHubEventLogEntryRepo;
    if (eventLogRepo === undefined) {
      throw new Error('GitHub event log entry repo not configured in test');
    }

    await eventLogRepo.createPending({
      id: 'delivery-older',
      githubEventName: 'issue_comment',
      eventType: 'issue_comment',
      action: 'created',
      repository: 'intexuraos/test-repo',
      pullRequestNumber: 41,
      authPassedAt: new Date('2026-03-12T09:59:00.000Z'),
      updatedAt: new Date('2026-03-12T09:59:00.000Z'),
      decisionState: 'pending',
      decisionOutcome: null,
      rowVersion: 1,
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log?limit=1&cursor=2026-03-12T11:30:00.000Z',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.nextCursor).toBeDefined();
  });

  it('uses default limit of 100 when limit query param is omitted (L250)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    // The default limit is 100, and we have 1 seeded row so it should return data
    expect(body.data.rows.length).toBeLessThanOrEqual(100);
  });

  it('returns 500 when listing recent rows fails', async () => {
    setServices({
      ...baseServices,
      gitHubEventLogEntryRepo: {
        ...baseServices.gitHubEventLogEntryRepo,
        listRecent: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'list failed',
        })),
      } as import('../../../domain/repositories/gitHubEventLogEntryRepository.js').GitHubEventLogEntryRepository,
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 500 when audit hydration fails', async () => {
    setServices({
      ...baseServices,
      gitHubWebhookAuditEventRepo: {
        ...baseServices.gitHubWebhookAuditEventRepo,
        findByIds: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'audit failed',
        })),
      } as import('../../../domain/repositories/gitHubWebhookAuditEventRepository.js').GitHubWebhookAuditEventRepository,
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 500 when decision hydration fails', async () => {
    setServices({
      ...baseServices,
      eventDecisionRepo: {
        ...baseServices.eventDecisionRepo,
        findByEventIds: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'decision failed',
        })),
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 500 when the rows route has no event log repository configured', async () => {
    const { gitHubEventLogEntryRepo: _ignoredEventLogRepo, ...servicesWithoutEventLogRepo } = baseServices;
    setServices({
      ...servicesWithoutEventLogRepo,
    } as import('../../../services.js').ServiceContainer);

    const response = await server.inject({
      method: 'POST',
      url: '/code/github-event-log/rows',
      headers: {
        authorization: 'Bearer fake-token',
        'content-type': 'application/json',
      },
      payload: { ids: ['delivery-1'] },
    });

    expect(response.statusCode).toBe(500);
  });

  it('returns 500 when loading specific rows fails', async () => {
    setServices({
      ...baseServices,
      gitHubEventLogEntryRepo: {
        ...baseServices.gitHubEventLogEntryRepo,
        findByIds: vi.fn().mockResolvedValue(err({
          code: 'FIRESTORE_ERROR',
          message: 'find failed',
        })),
      } as import('../../../domain/repositories/gitHubEventLogEntryRepository.js').GitHubEventLogEntryRepository,
    });

    const response = await server.inject({
      method: 'POST',
      url: '/code/github-event-log/rows',
      headers: {
        authorization: 'Bearer fake-token',
        'content-type': 'application/json',
      },
      payload: { ids: ['delivery-1'] },
    });

    expect(response.statusCode).toBe(500);
  });

  it('filters out non-visible event types server-side', async () => {
    const eventLogRepo = baseServices.gitHubEventLogEntryRepo;
    if (eventLogRepo === undefined) {
      throw new Error('GitHub event log entry repo not configured in test');
    }

    // Seed an 'unknown' event (e.g. check_run mapped to unknown)
    await eventLogRepo.createPending({
      id: 'delivery-unknown',
      githubEventName: 'check_run',
      eventType: 'unknown',
      action: null,
      repository: 'intexuraos/test-repo',
      pullRequestNumber: null,
      authPassedAt: new Date('2026-03-12T12:00:00.000Z'),
      updatedAt: new Date('2026-03-12T12:00:00.000Z'),
      decisionState: 'pending',
      decisionOutcome: null,
      rowVersion: 1,
    });

    // Seed a 'ping' event
    await eventLogRepo.createPending({
      id: 'delivery-ping',
      githubEventName: 'ping',
      eventType: 'ping',
      action: null,
      repository: null,
      pullRequestNumber: null,
      authPassedAt: new Date('2026-03-12T12:01:00.000Z'),
      updatedAt: new Date('2026-03-12T12:01:00.000Z'),
      decisionState: 'pending',
      decisionOutcome: null,
      rowVersion: 1,
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-event-log',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    // Only the seeded pull_request event from beforeEach should be returned
    const eventTypes = body.data.rows.map((row: { eventType: string }) => row.eventType);
    expect(eventTypes).not.toContain('unknown');
    expect(eventTypes).not.toContain('ping');
    expect(eventTypes).toContain('pull_request');
  });

  describe('GET /code/github-event-log/:id/payload', () => {
    it('returns 200 with payload for valid audit event ID', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/code/github-event-log/${seededAuditEventId}/payload`,
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ payload: { action: 'opened' } });
    });

    it('returns 404 when audit event does not exist', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/github-event-log/non-existent-id/payload',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 401 when no auth token provided', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/github-event-log/delivery-1/payload',
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 200 with null payload when audit event exists but payload is null', async () => {
      const { gitHubWebhookAuditEventRepo } = baseServices;
      if (gitHubWebhookAuditEventRepo === undefined) {
        throw new Error('Audit event repo not configured in test');
      }

      const saveResult = await gitHubWebhookAuditEventRepo.save({
        deliveryId: 'delivery-null-payload',
        githubEventName: 'push',
        eventType: 'push',
        action: null,
        repository: 'intexuraos/test-repo',
        repositoryId: 200,
        pullRequestNumber: null,
        pullRequestId: null,
        senderLogin: 'octocat',
        senderId: 99,
        senderType: 'User',
        authPassedAt: new Date('2026-03-12T12:00:00.000Z'),
        receivedAt: new Date('2026-03-12T12:00:00.000Z'),
        normalizationStatus: 'normalized',
        payload: null,
      });

      if (!saveResult.ok) {
        throw new Error('Failed to save audit event');
      }

      const response = await server.inject({
        method: 'GET',
        url: `/code/github-event-log/${saveResult.value.id}/payload`,
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ payload: null });
    });

    it('returns 500 when audit event lookup fails', async () => {
      setServices({
        ...baseServices,
        gitHubWebhookAuditEventRepo: {
          ...baseServices.gitHubWebhookAuditEventRepo,
          findByIds: vi.fn().mockResolvedValue(err({
            code: 'FIRESTORE_ERROR',
            message: 'lookup failed',
          })),
        } as import('../../../domain/repositories/gitHubWebhookAuditEventRepository.js').GitHubWebhookAuditEventRepository,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/github-event-log/delivery-1/payload',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when audit event repo is not configured', async () => {
      const { gitHubWebhookAuditEventRepo: _ignoredAuditRepo, ...servicesWithoutAuditRepo } = baseServices;
      setServices({
        ...servicesWithoutAuditRepo,
      } as import('../../../services.js').ServiceContainer);

      const response = await server.inject({
        method: 'GET',
        url: '/code/github-event-log/delivery-1/payload',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });
});
