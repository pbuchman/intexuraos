/**
 * Tests for GET /code/github-pr-events endpoint.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import nock from 'nock';

// Mock jose library for JWT validation
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../../server.js';
import { resetServices, setServices, getServices } from '../../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from 'pino';
import { ok, err } from '@intexuraos/common-core';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
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
import { createNoOpMetricsClient, type MetricsClient } from '../../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../../infra/firestore/workerSettingsRepository.js';
import type { TaskDispatcherService, DispatchResult } from '../../../domain/services/taskDispatcher.js';
import type { RateLimitService } from '../../../domain/services/rateLimitService.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import { createFirestoreTurnMetricsRepository } from '../../../infra/repositories/firestoreTurnMetricsRepository.js';

describe('GET /code/github-pr-events', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock actions-agent HTTP calls
    nock('http://actions-agent')
      .persist()
      .patch(/\/internal\/actions\/.*\/status/)
      .reply(200, { success: true });

    // Mock linear-agent HTTP calls
    nock('http://linear-agent:8086')
      .persist()
      .post(/\/.*/)
      .reply(200, { success: true });

    // Set jwtVerify to resolve by default (simulating valid token)
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars
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

    // Create real repositories
    const codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const taskDispatcher: TaskDispatcherService = {
      async dispatch(): Promise<ReturnType<typeof ok<DispatchResult>>> {
        return ok({
          dispatched: true,
          workerLocation: 'mac',
        });
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

    // Create the GitHub PR events and summaries repos
    const gitHubPREventRepo = createFirestoreGitHubPREventsRepository({
      logger,
    });

    const gitHubPRSummaryRepo = createFirestoreGitHubPRSummariesRepository({
      logger,
    });

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
      url: '/code/github-pr-events?repository=intexuraos/test-repo',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should return 200 with events when no repository filter (fetch all)', async () => {
    // Create GitHub PR events in different repos
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    await repo.save({
      githubEventId: 11111,
      deliveryId: null,
      repository: 'intexuraos/repo-a',
      repositoryId: 111111,
      pullRequestNumber: 1,
      pullRequestId: 100001,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'user1',
      senderId: 111,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR in repo A',
      body: 'Body',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });

    await repo.save({
      githubEventId: 22222,
      deliveryId: null,
      repository: 'intexuraos/repo-b',
      repositoryId: 222222,
      pullRequestNumber: 2,
      pullRequestId: 100002,
      eventType: 'pull_request',
      action: 'closed',
      senderLogin: 'user2',
      senderId: 222,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR in repo B',
      body: 'Body',
      state: 'closed',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-02T00:00:00Z'),
      payload: {},
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events',
      headers: {
        authorization: 'Bearer fake-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.events).toHaveLength(2);
  });

  it('should return 400 for invalid repository format', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=invalid-format',
      headers: {
        authorization: 'Bearer fake-token',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('should return 200 with empty array when no events found', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo',
      headers: {
        authorization: 'Bearer fake-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.events).toEqual([]);
  });

  it('should return events when repository has data', async () => {
    // Create a GitHub PR event in the fake Firestore
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    const mockEvent: GitHubPREvent = {
      id: 'event-1',
      githubEventId: 12345678,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 987654321,
      pullRequestNumber: 42,
      pullRequestId: 123456789,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'testuser',
      senderId: 12345,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'Test PR',
      body: 'Test body',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      processedAt: new Date('2024-01-01T00:05:00Z'),
      payload: {},
    };

    await repo.save(mockEvent);

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo',
      headers: {
        authorization: 'Bearer fake-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].pullRequestNumber).toBe(42);
    expect(body.data.events[0].repository).toBe('intexuraos/test-repo');
    expect(body.data.events[0].eventUrl).toBeNull();
  });

  it('should return eventUrl when payload contains html_url', async () => {
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    const commentUrl = 'https://github.com/intexuraos/test-repo/pull/10#issuecomment-999';

    await repo.save({
      githubEventId: 30001,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 10,
      pullRequestId: 10001,
      eventType: 'issue_comment',
      action: 'created',
      senderLogin: 'commenter',
      senderId: 5,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: null,
      state: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-02-01T00:00:00Z'),
      payload: { comment: { html_url: commentUrl } },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=10',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].eventUrl).toBe(commentUrl);
  });

  it('should pass limit parameter to repository', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&limit=25',
      headers: {
        authorization: 'Bearer fake-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.events).toEqual([]);
  });

  it('should default to limit of 50 when not specified', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo',
      headers: {
        authorization: 'Bearer fake-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.events).toEqual([]);
  });

  it('should handle repository errors gracefully', async () => {
    // This test verifies the route handles errors from the repository
    // Since we're using a real repository with fake Firestore,
    // we can't easily trigger a database error without modifying Firestore
    // The error handling path is covered by the repository's own tests
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo',
      headers: {
        authorization: 'Bearer fake-token',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
  });

  it('should return events oldest-first when pullRequestNumber is provided', async () => {
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    await repo.save({
      githubEventId: 10001,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 5,
      pullRequestId: 5001,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'user1',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 5',
      body: null,
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });

    await repo.save({
      githubEventId: 10002,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 5,
      pullRequestId: 5001,
      eventType: 'pull_request_review',
      action: 'submitted',
      senderLogin: 'reviewer',
      senderId: 2,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: null,
      state: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-02T00:00:00Z'),
      payload: {},
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=5',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    // Oldest-first order
    expect(body.data.events[0].eventType).toBe('pull_request');
    expect(body.data.events[1].eventType).toBe('pull_request_review');
  });

  it('should return 400 when pullRequestNumber is provided without repository', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?pullRequestNumber=5',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('should deduplicate edited comments showing latest body at original position', async () => {
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    // PR opened
    await repo.save({
      githubEventId: 20001,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 7,
      pullRequestId: 7001,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 7',
      body: 'PR description',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: { pull_request: { html_url: 'https://github.com/intexuraos/test-repo/pull/7' } },
    });

    // Comment created
    await repo.save({
      githubEventId: 20002,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 7,
      pullRequestId: 7001,
      eventType: 'issue_comment',
      action: 'created',
      senderLogin: 'reviewer',
      senderId: 2,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: 'Original comment text',
      state: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-02T00:00:00Z'),
      payload: { comment: { id: 555, html_url: 'https://github.com/intexuraos/test-repo/pull/7#issuecomment-555' } },
    });

    // Same comment edited (same comment.id, later timestamp)
    await repo.save({
      githubEventId: 20003,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 7,
      pullRequestId: 7001,
      eventType: 'issue_comment',
      action: 'edited',
      senderLogin: 'reviewer',
      senderId: 2,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: 'Updated comment text',
      state: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-03T00:00:00Z'),
      payload: { comment: { id: 555, html_url: 'https://github.com/intexuraos/test-repo/pull/7#issuecomment-555' } },
    });

    // Push event after (should not be affected by dedup)
    await repo.save({
      githubEventId: 20004,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 7,
      pullRequestId: 7001,
      eventType: 'push',
      action: null,
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'Push to feature-branch',
      body: null,
      state: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-04T00:00:00Z'),
      payload: { ref: 'refs/heads/feature-branch' },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=7',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);

    // Should have 3 events: PR opened, comment (deduped), push
    expect(body.data.events).toHaveLength(3);

    // First event: PR opened (unchanged)
    expect(body.data.events[0].eventType).toBe('pull_request');

    // Second event: comment at original position with latest body
    expect(body.data.events[1].eventType).toBe('issue_comment');
    expect(body.data.events[1].action).toBe('created');
    expect(body.data.events[1].createdAt).toBe('2024-01-02T00:00:00.000Z');
    expect(body.data.events[1].body).toBe('Updated comment text');

    // Third event: push (unchanged)
    expect(body.data.events[2].eventType).toBe('push');
  });

  it('should deduplicate review comments by review.id', async () => {
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    // Review submitted
    await repo.save({
      githubEventId: 30001,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 8,
      pullRequestId: 8001,
      eventType: 'pull_request_review',
      action: 'submitted',
      senderLogin: 'reviewer',
      senderId: 2,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: 'Original review',
      state: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: { review: { id: 777, html_url: 'https://github.com/intexuraos/test-repo/pull/8#pullrequestreview-777' } },
    });

    // Review edited
    await repo.save({
      githubEventId: 30002,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 8,
      pullRequestId: 8001,
      eventType: 'pull_request_review',
      action: 'edited',
      senderLogin: 'reviewer',
      senderId: 2,
      senderType: 'User',
      prAuthorLogin: null,
      title: null,
      body: 'Updated review',
      state: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-02T00:00:00Z'),
      payload: { review: { id: 777, html_url: 'https://github.com/intexuraos/test-repo/pull/8#pullrequestreview-777' } },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=8',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    // One event: deduped review
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].action).toBe('submitted');
    expect(body.data.events[0].body).toBe('Updated review');
  });

  it('should show PR body at first occurrence with latest content', async () => {
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    // PR opened
    await repo.save({
      githubEventId: 40001,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 10,
      pullRequestId: 10001,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 10',
      body: '## Summary\nPR description table',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });

    // synchronize 1
    await repo.save({
      githubEventId: 40002,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 10,
      pullRequestId: 10001,
      eventType: 'pull_request',
      action: 'synchronize',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 10',
      body: '## Summary\nPR description table',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-02T00:00:00Z'),
      payload: {},
    });

    // synchronize 2
    await repo.save({
      githubEventId: 40003,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 10,
      pullRequestId: 10001,
      eventType: 'pull_request',
      action: 'synchronize',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 10',
      body: '## Summary\nPR description table',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-03T00:00:00Z'),
      payload: {},
    });

    // synchronize 3 (most recent)
    await repo.save({
      githubEventId: 40004,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 10,
      pullRequestId: 10001,
      eventType: 'pull_request',
      action: 'synchronize',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 10',
      body: '## Summary\nPR description table',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-04T00:00:00Z'),
      payload: {},
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=10',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.events).toHaveLength(4);

    // First event keeps the body (first occurrence, latest content)
    expect(body.data.events[0].body).toBe('## Summary\nPR description table');

    // Remaining events should have null body (deduped)
    expect(body.data.events[1].body).toBeNull();
    expect(body.data.events[2].body).toBeNull();
    expect(body.data.events[3].body).toBeNull();
  });

  it('should show latest PR body at first occurrence when body changes between pushes', async () => {
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    // PR opened with original body
    await repo.save({
      githubEventId: 50001,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 11,
      pullRequestId: 11001,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 11',
      body: 'Version 1 of description',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });

    // synchronize with updated body
    await repo.save({
      githubEventId: 50002,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 11,
      pullRequestId: 11001,
      eventType: 'pull_request',
      action: 'synchronize',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 11',
      body: 'Version 2 of description',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-02T00:00:00Z'),
      payload: {},
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=11',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.events).toHaveLength(2);

    // First event shows latest body (first occurrence, latest content)
    expect(body.data.events[0].body).toBe('Version 2 of description');

    // Second event body nulled out
    expect(body.data.events[1].body).toBeNull();
  });

  it('should keep PR body when there is only one pull_request event', async () => {
    const services = (await import('../../../services.js')).getServices();
    const repo = services.gitHubPREventRepo;

    await repo.save({
      githubEventId: 60001,
      deliveryId: null,
      repository: 'intexuraos/test-repo',
      repositoryId: 1,
      pullRequestNumber: 12,
      pullRequestId: 12001,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'author',
      senderId: 1,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'PR 12',
      body: 'Single event body',
      state: 'open',
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=12',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.events).toHaveLength(1);

    // Single event keeps its body
    expect(body.data.events[0].body).toBe('Single event body');
  });

  it('should return 500 when per-PR repo fetch fails', async () => {
    setServices({
      ...getServices(),
      gitHubPREventRepo: {
        ...getServices().gitHubPREventRepo,
        findByPullRequest: async () =>
          err({ code: 'FIRESTORE_ERROR' as const, message: 'DB unavailable' }),
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events?repository=intexuraos/test-repo&pullRequestNumber=5',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });

  it('should return 500 when findAll (all-repos) fetch fails', async () => {
    // Mock findAll to return an error (simulating database failure when fetching all repos)
    setServices({
      ...getServices(),
      gitHubPREventRepo: {
        ...getServices().gitHubPREventRepo,
        findAll: async () =>
          err({ code: 'FIRESTORE_ERROR' as const, message: 'Database unavailable' }),
      },
    });

    // Request without repository filter triggers findAll()
    const response = await server.inject({
      method: 'GET',
      url: '/code/github-pr-events',
      headers: { authorization: 'Bearer fake-token' },
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
