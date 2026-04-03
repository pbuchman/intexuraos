/**
 * Tests for webhook endpoints
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';

// Mock jose library for JWT validation
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

vi.mock('@intexuraos/infra-gpt', () => ({
  EmbeddingClient: vi.fn().mockImplementation(() => ({
    createEmbedding: vi.fn(),
  })),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn(),
    },
  })),
}));

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../server.js';

import { getServices, resetServices, setServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { err, ok } from '@intexuraos/common-core';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createActionsAgentClient, type ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import crypto from 'node:crypto';
import { fetchWithAuth, type UserServiceClient } from '@intexuraos/internal-clients';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createArchiveStaleGroupsUseCase } from '../../domain/usecases/archiveStaleGroups.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { CreateRemediationTaskRequest, CreateRemediationTaskResult, CreateRemediationTaskError } from '../../domain/usecases/createRemediationTask.js';
import type { Result } from '@intexuraos/common-core';

// Mock fetchWithAuth
vi.mock('@intexuraos/internal-clients', async () => ({
  fetchWithAuth: vi.fn(),
}));

// Mock drainTaskQueue so tests can assert it is (or is not) called
vi.mock('../../domain/usecases/drainTaskQueue.js', () => ({
  drainTaskQueue: vi.fn().mockResolvedValue({ ok: true, value: { action: 'dispatched' } }),
  _resetDrainGuard: vi.fn(),
}));
import * as drainTaskQueueModule from '../../domain/usecases/drainTaskQueue.js';

describe('POST /internal/webhooks/task-complete', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;
  let logLineRepo: LogLineRepository;
  let actionsAgentClient: ActionsAgentClient;
  let mockFetchWithAuth: ReturnType<typeof vi.fn>;
  let mockWhatsAppPublisher: { publishSendMessage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
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
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logLineRepo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    taskDispatcher = createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe });
    const workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });
    mockWhatsAppPublisher = {
      publishSendMessage: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: mockWhatsAppPublisher as unknown as WhatsAppSendPublisher,
    });

    actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);
    vi.spyOn(linearAgentClient, 'validateIssue').mockResolvedValue(
      ok({
        id: 'linear-issue-uuid',
        identifier: 'INT-123',
        title: 'Test issue',
        url: 'https://linear.app/pbuchman/issue/INT-123',
        labels: [],
        childCount: 0,
        parentId: null,
      })
    );
    vi.spyOn(linearAgentClient, 'fetchIssueTree').mockResolvedValue(
      ok({
        root: {
          id: 'linear-issue-uuid',
          identifier: 'INT-999',
          url: 'https://linear.app/pbuchman/issue/INT-999',
          parentId: 'linear-issue-uuid',
          labels: [],
          assigneeId: null,
          state: 'Backlog',
        },
        descendants: [],
      })
    );
    vi.spyOn(linearAgentClient, 'fetchDirectChildrenLive').mockResolvedValue(ok([]));
    vi.spyOn(linearAgentClient, 'updateIssueMetadata').mockResolvedValue(ok({ droppedLabels: [] }));
    vi.spyOn(linearAgentClient, 'addComment').mockResolvedValue(ok({ commentId: 'comment-1' }));
    vi.spyOn(linearAgentClient, 'updateIssueState').mockResolvedValue(ok(undefined));

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
      logger,
    });

    mockFetchWithAuth = fetchWithAuth as ReturnType<typeof vi.fn>;
    mockFetchWithAuth.mockResolvedValue(ok(undefined));

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
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      logChunkRepo,
      logLineRepo,
      taskDispatcher,
      workerSettingsRepo,
      whatsappNotifier,
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
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
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
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      codeTaskRepo: CodeTaskRepository;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      taskDispatcher: TaskDispatcherService;
      workerSettingsRepo: WorkerSettingsRepository;
      actionsAgentClient: ActionsAgentClient;
      linearAgentClient: LinearAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      archiveStaleGroups: import('../../domain/usecases/archiveStaleGroups.js').ArchiveStaleGroupsUseCase;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });

    app = await buildServer();
  });

  afterEach(() => {
    delete process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'];
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    return { timestamp, signature };
  }

  function installPRNotificationServices(): {
    gitHubPRClient: GitHubPRClient;
    userServiceClient: UserServiceClient;
  } {
    const gitHubPRClient = {
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 42 })),
      updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
      getPullRequestFiles: vi.fn().mockResolvedValue(ok([])),
      getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
      getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('development')),
      getPullRequestStatus: vi.fn().mockResolvedValue(
        ok({ state: 'open', mergedAt: null, headRef: 'task_existing_pr_branch' })
      ),
      listOpenPullRequestsByBaseBranch: vi.fn().mockResolvedValue(ok([])),
      getPullRequestDetails: vi.fn().mockResolvedValue(ok(null)),
      mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'abc123', merged: true })),
      getCombinedCheckStatus: vi.fn().mockResolvedValue(ok({ state: 'success' })),
      listAllOpenPullRequests: vi.fn().mockResolvedValue(ok([])),
    } as unknown as GitHubPRClient;
    const userServiceClient = {
      ...mockUserServiceClient,
      getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'ghp_test_token', email: 'test@example.com' })),
    } as UserServiceClient;

    setServices({
      ...getServices(),
      gitHubPRClient,
      userServiceClient,
    });

    return { gitHubPRClient, userServiceClient };
  }

  describe('authentication', () => {
    it('rejects request without X-Internal-Auth header', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('rejects request with invalid X-Internal-Auth header', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'invalid-token',
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('signature validation', () => {
    it('rejects request with missing signature', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('MISSING_SIGNATURE');
    });

    it('rejects request with expired timestamp', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Timestamp from 20 minutes ago
      const expiredTimestamp = String(Math.floor((Date.now() - 20 * 60 * 1000) / 1000));

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': expiredTimestamp,
          'x-request-signature': 'signature',
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('EXPIRED_SIGNATURE');
    });

    it('rejects request with invalid signature', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
          'x-request-signature': 'invalid-signature',
        },
        payload: {
          taskId: task.id,
          status: 'completed',
          result: {
            branch: 'test-branch',
            commits: 1,
            summary: 'Test summary',
          },
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('returns UNKNOWN_TASK when findById fails during HMAC secret lookup (L189)', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_189',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Mock findById to fail (simulate DB error during HMAC secret lookup)
      const spy = vi.spyOn(codeTaskRepo, 'findById').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'DB unavailable' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: { branch: 'test-branch', commits: 1, summary: 'Test summary' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNKNOWN_TASK');
      spy.mockRestore();
    });

    it('returns UNKNOWN_TASK when task has no webhookSecret (L192)', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_192',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Mock findById to return task WITHOUT webhookSecret
      const { webhookSecret: _removed, ...taskWithoutSecret } = task;
      const spy = vi.spyOn(codeTaskRepo, 'findById').mockResolvedValueOnce(
        ok(taskWithoutSecret as typeof task)
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: { branch: 'test-branch', commits: 1, summary: 'Test summary' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('UNKNOWN_TASK');
      spy.mockRestore();
    });

    it('accepts valid signed request', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Test summary',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received).toBe(true);
    });
  });

  describe('task lookup after HMAC', () => {
    it('returns NOT_FOUND when task lookup fails after HMAC validation passes (L230)', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_230',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: { branch: 'test-branch', commits: 1, summary: 'Test summary' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      // First findById call (HMAC validation) succeeds, second call fails
      const spy = vi.spyOn(codeTaskRepo, 'findById')
        .mockResolvedValueOnce(ok(task)) // HMAC lookup succeeds
        .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'Task vanished' })); // Post-HMAC lookup fails

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error.code).toBe('NOT_FOUND');
      spy.mockRestore();
    });
  });

  describe('task status updates', () => {
    it('updates task status correctly for completed task', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 3,
          summary: 'Fixed the bug',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task was updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
      expect(getResult.value.result?.branch).toBe('test-branch');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('flushes a trailing Codex log fragment when the task completes', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'default',
        workerType: 'codex',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_codex_flush_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const lineStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');

      const rawFragment = JSON.stringify({
        type: 'turn.failed',
        error: { message: 'boom' },
      });

      const logsPayload = {
        taskId: task.id,
        chunks: [
          {
            sequence: 1,
            content: rawFragment,
            timestamp: new Date().toISOString(),
          },
        ],
      };

      const logsSig = generateWebhookSignature(logsPayload, 'test-webhook-secret');
      const logsResponse = await app.inject({
        method: 'POST',
        url: '/internal/logs',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': logsSig.timestamp,
          'x-request-signature': logsSig.signature,
        },
        payload: logsPayload,
      });

      expect(logsResponse.statusCode).toBe(200);
      expect(lineStoreSpy).not.toHaveBeenCalled();

      const completePayload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'CODEX_FAILED',
          message: 'Codex failed',
        },
      };

      const completeSig = generateWebhookSignature(completePayload, 'test-webhook-secret');
      const completeResponse = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': completeSig.timestamp,
          'x-request-signature': completeSig.signature,
        },
        payload: completePayload,
      });

      expect(completeResponse.statusCode).toBe(200);
      expect(lineStoreSpy).toHaveBeenCalledOnce();
      const flushedLines = lineStoreSpy.mock.calls[0]?.[1];
      expect(flushedLines?.[0]?.text).toBe(rawFragment);
    });

    it('does not flush extra log lines on task completion when Codex logs already ended with a newline', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'default',
        workerType: 'codex',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_codex_no_flush_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const lineStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');
      const rawLine = JSON.stringify({
        type: 'turn.completed',
        usage: { output_tokens: 1 },
      }) + '\n';

      const logsPayload = {
        taskId: task.id,
        chunks: [
          {
            sequence: 1,
            content: rawLine,
            timestamp: new Date().toISOString(),
          },
        ],
      };
      const logsSig = generateWebhookSignature(logsPayload, 'test-webhook-secret');
      await app.inject({
        method: 'POST',
        url: '/internal/logs',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': logsSig.timestamp,
          'x-request-signature': logsSig.signature,
        },
        payload: logsPayload,
      });

      const completePayload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'CODEX_FAILED',
          message: 'Codex failed',
        },
      };
      const completeSig = generateWebhookSignature(completePayload, 'test-webhook-secret');
      const completeResponse = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': completeSig.timestamp,
          'x-request-signature': completeSig.signature,
        },
        payload: completePayload,
      });

      expect(completeResponse.statusCode).toBe(200);
      expect(lineStoreSpy).toHaveBeenCalledTimes(1);
      expect(lineStoreSpy.mock.calls[0]?.[1]?.[0]?.text).toBe(rawLine.trimEnd());
    });

    it('logs an error when flushing pending Codex log lines fails on task completion', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'default',
        workerType: 'codex',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_codex_flush_error_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const lineStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');
      const loggerErrorSpy = vi.spyOn(logger, 'error');

      const rawFragment = JSON.stringify({
        type: 'turn.failed',
        error: { message: 'boom' },
      });

      const logsPayload = {
        taskId: task.id,
        chunks: [
          {
            sequence: 1,
            content: rawFragment,
            timestamp: new Date().toISOString(),
          },
        ],
      };
      const logsSig = generateWebhookSignature(logsPayload, 'test-webhook-secret');
      await app.inject({
        method: 'POST',
        url: '/internal/logs',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': logsSig.timestamp,
          'x-request-signature': logsSig.signature,
        },
        payload: logsPayload,
      });

      lineStoreSpy.mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'write failed' }));

      const completePayload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'CODEX_FAILED',
          message: 'Codex failed',
        },
      };
      const completeSig = generateWebhookSignature(completePayload, 'test-webhook-secret');
      const completeResponse = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': completeSig.timestamp,
          'x-request-signature': completeSig.signature,
        },
        payload: completePayload,
      });

      expect(completeResponse.statusCode).toBe(200);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.id }),
        'Failed to flush pending log lines on task completion',
      );
    });

    it('maps planning-agent planned completion to planned status and stores flattened planning result', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan the refactor',
        sanitizedPrompt: 'Plan the refactor',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Created planning issue and plan PR',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: '',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('planned');
      expect(getResult.value.result?.planning_outcome_label).toBe('planned');
      expect(getResult.value.result?.planning_linear_url).toContain('/INT-123');
    });

    it('complex planned: accepts correctly delivered subtasks without normalization', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan complex task',
        sanitizedPrompt: 'Plan complex task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 2,
          parentId: null,
        })
      );
      fetchDirectChildrenLiveSpy.mockResolvedValue(
        ok([
          {
            id: 'child-1-uuid',
            identifier: 'INT-200',
            url: 'https://linear.app/pbuchman/issue/INT-200',
            parentId: 'original-uuid',
            labels: ['code-task'],
            assigneeId: null,
            state: 'Todo',
          },
          {
            id: 'child-2-uuid',
            identifier: 'INT-201',
            url: 'https://linear.app/pbuchman/issue/INT-201',
            parentId: 'original-uuid',
            labels: ['code-task'],
            assigneeId: null,
            state: 'Todo',
          },
        ])
      );
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Created complex plan with subtasks',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: '',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Original issue → todo + planned label
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'original-uuid', state: 'todo' })
      );
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'original-uuid',
          addLabels: ['complex-task'],
          removeLabels: ['unclear', 'code-task', 'planning-task'],
        })
      );
      // Original + 2 children normalized to todo
      expect(updateIssueStateSpy).toHaveBeenCalledTimes(3);
      // Original labels + 2 children (normalize + stamp in single call)
      expect(updateIssueMetadataSpy).toHaveBeenCalledTimes(3);
      // PR comment on issue
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'original-uuid',
          body: 'Planning PR: https://github.com/pbuchman/intexuraos/pull/999',
        })
      );
    });

    it('complex planned: normalizes subtask with wrong state/labels/assignee', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan with bad subtask state',
        sanitizedPrompt: 'Plan with bad subtask state',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 1,
          parentId: null,
        })
      );
      fetchDirectChildrenLiveSpy.mockResolvedValue(
        ok([
          {
            id: 'child-uuid',
            identifier: 'INT-200',
            url: 'https://linear.app/pbuchman/issue/INT-200',
            parentId: 'original-uuid',
            labels: [],
            assigneeId: 'some-user',
            state: 'Backlog',
          },
        ])
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Subtask not delivered correctly',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: '',
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Implementation normalizes subtasks instead of rejecting
      expect(response.statusCode).toBe(200);
    });

    it('complex planned: skips non-direct children in fallback path', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan with non-direct children',
        sanitizedPrompt: 'Plan with non-direct children',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 1,
          parentId: null,
        })
      );
      fetchDirectChildrenLiveSpy.mockResolvedValue(
        ok([
          {
            id: 'grandchild-uuid',
            identifier: 'INT-300',
            url: 'https://linear.app/pbuchman/issue/INT-300',
            parentId: 'some-other-parent',
            labels: [],
            assigneeId: null,
            state: 'Backlog',
          },
        ])
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Planned with non-direct subtask',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: '',
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Fallback filters to direct children only — grandchild is skipped, not rejected
      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('planned');
    });

    it('complex planned: no PR comment when planning_pr_url is empty', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan complex without PR',
        sanitizedPrompt: 'Plan complex without PR',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 1,
          parentId: null,
        })
      );
      fetchDirectChildrenLiveSpy.mockResolvedValue(
        ok([
          {
            id: 'child-uuid',
            identifier: 'INT-200',
            url: 'https://linear.app/pbuchman/issue/INT-200',
            parentId: 'original-uuid',
            labels: ['code-task'],
            assigneeId: null,
            state: 'Todo',
          },
        ])
      );
      addCommentSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex but no PR',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: '',
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      // No PR comment should be added
      expect(addCommentSpy).not.toHaveBeenCalled();
    });

    it('complex planned: normalizes subtasks via URL-based resolution', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan complex task via URLs',
        sanitizedPrompt: 'Plan complex task via URLs',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy
        .mockResolvedValueOnce(
          ok({
            id: 'original-uuid',
            identifier: 'INT-123',
            title: 'Original issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: [],
            childCount: 2,
            parentId: null,
          })
        )
        .mockResolvedValueOnce(
          ok({
            id: 'child-1-uuid',
            identifier: 'INT-200',
            title: 'Subtask 1',
            url: 'https://linear.app/pbuchman/issue/INT-200',
            labels: [],
            childCount: 0,
            parentId: 'original-uuid',
          })
        )
        .mockResolvedValueOnce(
          ok({
            id: 'child-2-uuid',
            identifier: 'INT-201',
            title: 'Subtask 2',
            url: 'https://linear.app/pbuchman/issue/INT-201',
            labels: [],
            childCount: 0,
            parentId: 'original-uuid',
          })
        );
      fetchDirectChildrenLiveSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex plan with URL-based subtasks',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-200/subtask-1,https://linear.app/pbuchman/issue/INT-201/subtask-2',
          planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // fetchDirectChildrenLive must NOT be called — URL-based path was used
      expect(fetchDirectChildrenLiveSpy).not.toHaveBeenCalled();

      // validateIssue called: 1 for original + 2 for subtasks = 3 total (single pass)
      expect(validateIssueSpy).toHaveBeenCalledTimes(3);

      // Both subtasks normalized to todo
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-1-uuid', state: 'todo' })
      );
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-2-uuid', state: 'todo' })
      );

      // Both subtasks normalized + stamped with code-task in single call (removes assignee)
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-1-uuid', assigneeId: null, removeLabels: ['complex-task', 'unclear', 'planning-task'], addLabels: ['code-task'] })
      );
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-2-uuid', assigneeId: null, removeLabels: ['complex-task', 'unclear', 'planning-task'], addLabels: ['code-task'] })
      );

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('planned');
    });

    it('complex planned: rejects malformed subtask URLs', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan with malformed URLs',
        sanitizedPrompt: 'Plan with malformed URLs',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 2,
          parentId: null,
        })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex plan with bad URLs',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: 'not-a-url,https://linear.app/pbuchman/issue/INT-200/subtask-1',
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.message).toContain('Invalid subtask URL');
    });

    it('complex planned: falls back to fetchDirectChildrenLive when subtask URLs empty', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan complex task tree fallback',
        sanitizedPrompt: 'Plan complex task tree fallback',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 0,
          parentId: null,
        })
      );
      fetchDirectChildrenLiveSpy.mockResolvedValue(ok([]));
      fetchDirectChildrenLiveSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex plan without URLs',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: '',
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // fetchDirectChildrenLive must be called — fallback path
      expect(fetchDirectChildrenLiveSpy).toHaveBeenCalledTimes(1);
      expect(fetchDirectChildrenLiveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'original-uuid' })
      );

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('planned');
    });

    it('complex planned: falls back to fetchDirectChildrenLive when URL extraction is partial', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan complex task partial URLs',
        sanitizedPrompt: 'Plan complex task partial URLs',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      // Parent has 3 children but only 1 URL was extracted
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 3,
          parentId: null,
        })
      );
      fetchDirectChildrenLiveSpy.mockResolvedValue(
        ok([
          {
            id: 'child-1-uuid',
            identifier: 'INT-200',
            url: 'https://linear.app/pbuchman/issue/INT-200',
            parentId: 'original-uuid',
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          {
            id: 'child-2-uuid',
            identifier: 'INT-201',
            url: 'https://linear.app/pbuchman/issue/INT-201',
            parentId: 'original-uuid',
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          {
            id: 'child-3-uuid',
            identifier: 'INT-202',
            url: 'https://linear.app/pbuchman/issue/INT-202',
            parentId: 'original-uuid',
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
        ])
      );
      fetchDirectChildrenLiveSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex plan with partial URL extraction',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '1' as const,
          // Only 1 of 3 subtask URLs extracted by LLM
          planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-200/subtask-1',
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // fetchDirectChildrenLive must be called — partial extraction triggers fallback
      expect(fetchDirectChildrenLiveSpy).toHaveBeenCalledTimes(1);
      expect(fetchDirectChildrenLiveSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'original-uuid' })
      );

      // validateIssue called only once for original issue (no URL-based subtask resolution)
      expect(validateIssueSpy).toHaveBeenCalledTimes(1);

      // All 3 direct children normalized via tree fallback (removes assignee)
      expect(updateIssueStateSpy).toHaveBeenCalledTimes(4); // 1 parent + 3 children
      expect(updateIssueMetadataSpy).toHaveBeenCalledTimes(4); // 1 parent + 3 children
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-1-uuid', assigneeId: null, removeLabels: ['complex-task', 'unclear', 'planning-task'], addLabels: ['code-task'] })
      );
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-2-uuid', assigneeId: null, removeLabels: ['complex-task', 'unclear', 'planning-task'], addLabels: ['code-task'] })
      );
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-3-uuid', assigneeId: null, removeLabels: ['complex-task', 'unclear', 'planning-task'], addLabels: ['code-task'] })
      );

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('planned');
    });

    it('simple planned: skips tree validation, marks original todo with code-task label', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan simple fix',
        sanitizedPrompt: 'Plan simple fix',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const fetchDirectChildrenLiveSpy = vi.mocked(linearAgentClient.fetchDirectChildrenLive);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 0,
          parentId: null,
        })
      );
      fetchDirectChildrenLiveSpy.mockClear();
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Simple task planned in-place',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '0' as const,
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Should NOT fetch issue tree (simple task)
      expect(fetchDirectChildrenLiveSpy).not.toHaveBeenCalled();

      // Should only validate the original issue (1 call)
      expect(validateIssueSpy).toHaveBeenCalledTimes(1);

      // Should move original issue to todo
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'original-uuid', state: 'todo' })
      );

      // Simple: addLabels=[], removeLabels=['unclear', 'complex-task', 'planning-task'], then stamp code-task
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'original-uuid',
          addLabels: [],
          removeLabels: ['unclear', 'complex-task', 'planning-task'],
        })
      );
      // Stamp code-task label as last step (removes unclear + planning-task, clears assignee)
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'original-uuid',
          assigneeId: null,
          addLabels: ['code-task'],
          removeLabels: ['unclear', 'planning-task'],
        })
      );

      // Should NOT add a comment (simple task, no PR)
      expect(addCommentSpy).not.toHaveBeenCalled();

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('planned');
      expect(getResult.value.result?.planning_outcome_label).toBe('planned');
    });

    it('returns error when updateIssueState fails in simple planning path', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan simple fix',
        sanitizedPrompt: 'Plan simple fix',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 0,
          parentId: null,
        })
      );
      updateIssueStateSpy.mockReset();
      updateIssueStateSpy.mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear API down' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Simple task',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '0' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '0' as const,
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Enforcement failure returns 200 to orchestrator but saves task as failed
      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.message).toContain('Failed to normalize original issue state');
    });

    it('returns error when updateIssueMetadata fails in simple planning path', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Plan simple fix',
        sanitizedPrompt: 'Plan simple fix',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: [],
          childCount: 0,
          parentId: null,
        })
      );
      updateIssueStateSpy.mockReset();
      updateIssueStateSpy.mockResolvedValueOnce(ok(undefined));
      updateIssueMetadataSpy.mockReset();
      updateIssueMetadataSpy.mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear API down' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Simple task',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '0' as const,
          planning_linear_url: 'https://linear.app/pbuchman/issue/INT-123',
          planning_is_complex: '0' as const,
          planning_pr_url: '',
          planning_unclear_clarification: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Enforcement failure returns 200 to orchestrator but saves task as failed
      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.message).toContain('Failed to normalize original issue labels');
    });

    it('enforces execution-agent success on executed issue only and stores execution metadata', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);
      const linearIssueService = getServices().linearIssueService;
      const markInReviewSpy = vi.spyOn(linearIssueService, 'markInReview');

      validateIssueSpy.mockReset();
      validateIssueSpy
        .mockResolvedValueOnce(
          ok({
            id: 'routed-uuid',
            identifier: 'INT-123',
            title: 'Routed issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        )
        .mockResolvedValueOnce(
          ok({
            id: 'routed-uuid',
            identifier: 'INT-123',
            title: 'Routed issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        );
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();
      markInReviewSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/901',
          branch: 'feat/execution-agent',
          commits: 2,
          summary: 'Implemented execution task',
          execution_outcome_label: 'implemented' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'routed-uuid',
          body: expect.stringContaining(payload.result.prUrl),
        })
      );
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'routed-uuid', state: 'in_review' })
      );
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'routed-uuid', assigneeId: null, addLabels: ['code-task'], removeLabels: ['unclear', 'planning-task'] })
      );
      expect(markInReviewSpy).not.toHaveBeenCalled();

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
      expect(getResult.value.result?.execution_outcome_label).toBe('implemented');
      expect(getResult.value.result?.execution_linear_issue_url).toContain('/INT-123');
    });

    it('marks execution memory post-run pending and stores memory usage fields when feature flag is enabled', async () => {
      process.env['INTEXURAOS_EXECUTION_MEMORY_ENABLED'] = 'true';

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 't-exec-memory-pending',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const validateIssueSpy = vi.spyOn(getServices().linearAgentClient, 'validateIssue');
      validateIssueSpy.mockReset();
      validateIssueSpy
        .mockResolvedValueOnce(
          ok({
            id: 'routed-uuid',
            identifier: 'INT-123',
            title: 'Routed issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        )
        .mockResolvedValueOnce(
          ok({
            id: 'routed-uuid',
            identifier: 'INT-123',
            title: 'Routed issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/901',
          branch: 'feat/execution-agent',
          commits: 2,
          summary: 'Implemented execution task',
          execution_outcome_label: 'implemented' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
          execution_memory_ids_used: 'mem_142,mem_155',
          execution_memory_ids_rejected: 'mem_188',
          execution_memory_usage_summary: 'Used route logging and coverage lessons.',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.executionMemoryPostRun).toEqual(
        expect.objectContaining({
          status: 'pending',
          attempts: 0,
          generatedMemoryIds: [],
        })
      );
      expect(getResult.value.result?.execution_memory_ids_used).toBe('mem_142,mem_155');
      expect(getResult.value.result?.execution_memory_ids_rejected).toBe('mem_188');
      expect(getResult.value.result?.execution_memory_usage_summary).toBe(
        'Used route logging and coverage lessons.'
      );
    });

    it('does not post implementation completion comment when the final update fails', async () => {
      const { gitHubPRClient } = installPRNotificationServices();
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        prNumber: 901,
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      validateIssueSpy.mockReset();
      validateIssueSpy
        .mockResolvedValueOnce(
          ok({
            id: 'routed-uuid',
            identifier: 'INT-123',
            title: 'Routed issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        )
        .mockResolvedValueOnce(
          ok({
            id: 'routed-uuid',
            identifier: 'INT-123',
            title: 'Routed issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        );

      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/901',
          branch: 'feat/execution-agent',
          commits: 2,
          summary: 'Implemented execution task',
          execution_outcome_label: 'implemented' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();

      updateSpy.mockRestore();
    });

    it('does not queue execution-memory post-run work for non-execution agents', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_non_execution',
        linearIssueId: 'INT-123',
        agentType: 'planning',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Planned the task',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.executionMemoryPostRun).toBeUndefined();
    });

    it('handles markdown-wrapped execution_linear_issue_url in execution completion', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Execute with markdown URLs',
        sanitizedPrompt: 'Execute with markdown URLs',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      validateIssueSpy.mockResolvedValue(
        ok({
          id: 'routed-uuid',
          identifier: 'INT-123',
          title: 'Routed issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/901',
          branch: 'feat/execution-agent',
          commits: 2,
          summary: 'Implemented execution task',
          execution_outcome_label: 'implemented' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: '[INT-123](https://linear.app/pbuchman/issue/INT-123)',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      // validateIssue is called twice: once for routed issue (task.linearIssueId), once for reported issue.
      // Verify no call was made with the broken identifier 'INT-123)' (trailing paren from markdown)
      const brokenCall = validateIssueSpy.mock.calls.find(
        (call) => call[0].identifier === 'INT-123)'
      );
      expect(brokenCall).toBeUndefined();
    });

    it('fails execution deterministic enforcement on routed/reported issue mismatch before any Linear mutations', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement wrong issue',
        sanitizedPrompt: 'Implement wrong issue',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);
      validateIssueSpy.mockReset();
      validateIssueSpy
        .mockResolvedValueOnce(
          ok({
            id: 'routed-uuid',
            identifier: 'INT-123',
            title: 'Routed issue',
            url: 'https://linear.app/pbuchman/issue/INT-123',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        )
        .mockResolvedValueOnce(
          ok({
            id: 'different-uuid',
            identifier: 'INT-999',
            title: 'Wrong issue',
            url: 'https://linear.app/pbuchman/issue/INT-999',
            labels: ['code-task'],
            childCount: 0,
            parentId: null,
          })
        );
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/902',
          execution_outcome_label: 'implemented' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-999',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(addCommentSpy).not.toHaveBeenCalled();
      expect(updateIssueStateSpy).not.toHaveBeenCalled();
      expect(updateIssueMetadataSpy).not.toHaveBeenCalled();

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('EXECUTION_AGENT_WRONG_ISSUE_MISMATCH');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('fails execution deterministic enforcement when completed execution result is missing prUrl', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement without PR',
        sanitizedPrompt: 'Implement without PR',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          execution_outcome_label: 'implemented' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(addCommentSpy).not.toHaveBeenCalled();
      expect(updateIssueStateSpy).not.toHaveBeenCalled();
      expect(updateIssueMetadataSpy).not.toHaveBeenCalled();

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('EXECUTION_AGENT_ENFORCEMENT_FAILED');
    });

    it('already_completed enforcement succeeds — comment, done state, code-task label preserved', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'routed-uuid',
          identifier: 'INT-123',
          title: 'Routed issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Work was already merged into development',
          execution_outcome_label: 'already_completed' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '0' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'routed-uuid',
          body: expect.stringContaining('Work already completed'),
        })
      );
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'routed-uuid', state: 'done' })
      );
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'routed-uuid', assigneeId: null, addLabels: ['code-task'], removeLabels: ['unclear', 'planning-task'] })
      );

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
      expect(getResult.value.result?.execution_outcome_label).toBe('already_completed');
    });

    it('already_completed enforcement includes summary in Linear comment', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'routed-uuid',
          identifier: 'INT-123',
          title: 'Routed issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      addCommentSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'The feature was already implemented and merged in PR #850',
          execution_outcome_label: 'already_completed' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '0' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('The feature was already implemented and merged in PR #850'),
        })
      );
    });

    it('already_completed enforcement fails on addComment error', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'routed-uuid',
          identifier: 'INT-123',
          title: 'Routed issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      addCommentSpy.mockReset();
      addCommentSpy.mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear API down' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Work already done',
          execution_outcome_label: 'already_completed' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '0' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('EXECUTION_AGENT_ENFORCEMENT_FAILED');
    });

    it('already_completed enforcement fails on updateIssueState error', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'routed-uuid',
          identifier: 'INT-123',
          title: 'Routed issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      updateIssueStateSpy.mockReset();
      updateIssueStateSpy.mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear API down' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Work already done',
          execution_outcome_label: 'already_completed' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '0' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('EXECUTION_AGENT_ENFORCEMENT_FAILED');
      expect(getResult.value.error?.message).toContain('Failed to move already-completed issue to Done');
    });

    it('already_completed enforcement fails on updateIssueMetadata error', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the task',
        sanitizedPrompt: 'Implement the task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'routed-uuid',
          identifier: 'INT-123',
          title: 'Routed issue',
          url: 'https://linear.app/pbuchman/issue/INT-123',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      updateIssueMetadataSpy.mockReset();
      updateIssueMetadataSpy.mockResolvedValueOnce(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear API down' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Work already done',
          execution_outcome_label: 'already_completed' as const,
          execution_superpowers_subagent_driven_dev_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '0' as const,
          execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('EXECUTION_AGENT_ENFORCEMENT_FAILED');
      expect(getResult.value.error?.message).toContain('Failed to preserve code-task label on already-completed issue');
    });

    it('pull_request task rejects missing result payload', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Respond to PR comment',
        sanitizedPrompt: 'Respond to PR comment',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-456',
        webhookSecret: 'test-webhook-secret',
        agentType: 'pull_request',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('PULL_REQUEST_AGENT_ENFORCEMENT_FAILED');
      expect(getResult.value.error?.message).toContain('missing result payload');
    });

    it('pull_request task rejects missing prUrl', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Respond to PR comment',
        sanitizedPrompt: 'Respond to PR comment',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-456',
        webhookSecret: 'test-webhook-secret',
        agentType: 'pull_request',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          comment_replied: true,
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('PULL_REQUEST_AGENT_ENFORCEMENT_FAILED');
      expect(getResult.value.error?.message).toContain('prUrl');
    });

    it('pull_request task rejects missing comment_replied', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Respond to PR comment',
        sanitizedPrompt: 'Respond to PR comment',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-456',
        webhookSecret: 'test-webhook-secret',
        agentType: 'pull_request',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/100',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('PULL_REQUEST_AGENT_ENFORCEMENT_FAILED');
      expect(getResult.value.error?.message).toContain('comment_replied');
    });

    it('pull_request task succeeds with valid result and marks Linear In Review', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Respond to PR comment',
        sanitizedPrompt: 'Respond to PR comment',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-456',
        webhookSecret: 'test-webhook-secret',
        agentType: 'pull_request',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const linearIssueService = getServices().linearIssueService;
      const markInReviewSpy = vi.spyOn(linearIssueService, 'markInReview');

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'routed-uuid-456',
          identifier: 'INT-456',
          title: 'Pull request issue',
          url: 'https://linear.app/pbuchman/issue/INT-456',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      markInReviewSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/100',
          comment_replied: true,
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(addCommentSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'routed-uuid-456',
          body: expect.stringContaining('https://github.com/pbuchman/intexuraos/pull/100'),
        })
      );
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'routed-uuid-456', state: 'in_review' })
      );
      expect(markInReviewSpy).not.toHaveBeenCalled();

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
    });

    it('does not post reply completion comment when the final update fails', async () => {
      const { gitHubPRClient } = installPRNotificationServices();
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Respond to PR comment',
        sanitizedPrompt: 'Respond to PR comment',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-456',
        prNumber: 100,
        webhookSecret: 'test-webhook-secret',
        agentType: 'pull_request',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const validateIssueSpy = vi.mocked(linearAgentClient.validateIssue);
      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'routed-uuid-456',
          identifier: 'INT-456',
          title: 'Pull request issue',
          url: 'https://linear.app/pbuchman/issue/INT-456',
          labels: ['code-task'],
          childCount: 0,
          parentId: null,
        })
      );

      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/100',
          comment_replied: true,
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();

      updateSpy.mockRestore();
    });

    it('review task rejects empty review_types in completed payload', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'No review was performed.',
          review_comments_posted: '0',
          review_types: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('REVIEW_AGENT_ENFORCEMENT_FAILED');
      expect(getResult.value.error?.message).toContain('review_types');
    });

    it('review task clears stale error on successful completion', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const staleErrorResult = await codeTaskRepo.update(task.id, {
        error: {
          code: 'SETUP_FAILED',
          message: 'Anthropic API key is invalid: Orchestrator credentials expired or unavailable',
        },
      });
      expect(staleErrorResult.ok).toBe(true);
      if (!staleErrorResult.ok) throw new Error('Failed to seed stale error');

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Reviewed the PR and posted two comments.',
          review_comments_posted: '2',
          review_types: 'code_quality,architecture',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('reviewed');
      expect(getResult.value.error).toBeUndefined();
    });

    it('updates lastReviewedCommitSha on PR summary when review completes (INT-1087)', async () => {
      const { gitHubPRClient } = installPRNotificationServices();
      vi.mocked(gitHubPRClient.getPullRequestDetails).mockResolvedValue(
        ok({
          title: 'Test PR',
          body: '',
          authorLogin: 'alice',
          baseBranch: 'development',
          headBranch: 'feature/test',
          mergeable: true,
          mergeableState: 'clean',
          headSha: 'abc123def456',
        } as never)
      );

      const mockUpsert = vi.fn().mockResolvedValue(ok(undefined));
      setServices({
        ...getServices(),
        gitHubPRSummaryRepo: {
          ...getServices().gitHubPRSummaryRepo,
          upsert: mockUpsert,
        },
      });

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_sha_update',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
          summary: 'Reviewed and posted findings.',
          review_comments_posted: '2',
          review_types: 'code_quality',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task status
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('reviewed');

      // Verify lastReviewedCommitSha was updated on PR summary
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          repository: 'pbuchman/intexuraos',
          pullRequestNumber: 42,
          lastReviewedCommitSha: 'abc123def456',
        })
      );
    });

    it('skips PR summary upsert when OAuth token fetch fails (INT-1087)', async () => {
      const { userServiceClient } = installPRNotificationServices();
      vi.mocked(userServiceClient.getOAuthToken).mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND' as const, message: 'No token' })
      );

      const mockUpsert = vi.fn().mockResolvedValue(ok(undefined));
      setServices({
        ...getServices(),
        gitHubPRSummaryRepo: {
          ...getServices().gitHubPRSummaryRepo,
          upsert: mockUpsert,
        },
      });

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_token_fail',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
          summary: 'Reviewed.',
          review_comments_posted: '1',
          review_types: 'code_quality',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('skips PR summary upsert when PR details fetch fails (INT-1087)', async () => {
      const { gitHubPRClient } = installPRNotificationServices();
      vi.mocked(gitHubPRClient.getPullRequestDetails).mockResolvedValue(
        err({ code: 'NOT_FOUND' as const, message: 'PR not found' })
      );

      const mockUpsert = vi.fn().mockResolvedValue(ok(undefined));
      setServices({
        ...getServices(),
        gitHubPRSummaryRepo: {
          ...getServices().gitHubPRSummaryRepo,
          upsert: mockUpsert,
        },
      });

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_details_fail',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
          summary: 'Reviewed.',
          review_comments_posted: '1',
          review_types: 'code_quality',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('handles thrown error in lastReviewedCommitSha update gracefully (INT-1087)', async () => {
      const { userServiceClient } = installPRNotificationServices();
      vi.mocked(userServiceClient.getOAuthToken).mockRejectedValue(
        new Error('Network timeout')
      );

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_throw',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
          summary: 'Reviewed.',
          review_comments_posted: '1',
          review_types: 'code_quality',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Should still succeed — the catch block handles the error gracefully
      expect(response.statusCode).toBe(200);
    });

    it('records automation log for review failure when task has workerType', async () => {
      installPRNotificationServices();
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'opus',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Review failed due to enforcement.',
          review_comments_posted: '0',
          review_types: '',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      // Task failure is now recorded via automationLog.record() instead of direct PR comment
      const updatedTask = await codeTaskRepo.findById(task.id);
      expect(updatedTask.ok).toBe(true);
      if (updatedTask.ok) {
        expect(updatedTask.value.status).toBe('failed');
      }
    });

    it('handles execution-agent failed webhook without any Linear mutations', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Implement the failing task',
        sanitizedPrompt: 'Implement the failing task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const linearAgentClient = getServices().linearAgentClient;
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);
      addCommentSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: { code: 'WORKER_ERROR', message: 'Worker failed' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(addCommentSpy).not.toHaveBeenCalled();
      expect(updateIssueStateSpy).not.toHaveBeenCalled();
      expect(updateIssueMetadataSpy).not.toHaveBeenCalled();

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('populates prNumber and prBranch from result.prUrl on completion (INT-465)', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug with prNumber',
        sanitizedPrompt: 'Fix the bug with prNumber',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/pr-number-population',
          commits: 2,
          summary: 'Fixed PR number population',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/835',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.prNumber).toBe(835);
      expect(getResult.value.prBranch).toBe('fix/pr-number-population');
    });

    it('does not set prNumber when result has no prUrl (INT-465)', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug no prUrl',
        sanitizedPrompt: 'Fix the bug no prUrl',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/no-pr',
          commits: 1,
          summary: 'Fixed but no PR',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.prNumber).toBeUndefined();
      expect(getResult.value.prBranch).toBe('fix/no-pr');
    });

    it('does not set prNumber on failed webhook (INT-465)', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug fail case',
        sanitizedPrompt: 'Fix the bug fail case',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'WORKER_ERROR',
          message: 'Worker crashed',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.prNumber).toBeUndefined();
      expect(getResult.value.prBranch).toBeUndefined();
    });

    it('updates task status correctly for completed task without result', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'List all services',
        sanitizedPrompt: 'List all services',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
      expect(getResult.value.result).toBeUndefined();
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('accepts result with only summary (planning-agent tasks)', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Analyze auth flow',
        sanitizedPrompt: 'Analyze auth flow',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Analyzed the feature request and identified three approaches. Created design with test requirements.',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
      expect(getResult.value.result).toEqual({
        summary: 'Analyzed the feature request and identified three approaches. Created design with test requirements.',
      });
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('stores default error for failed tasks without error details', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('UNKNOWN_FAILURE');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('stores error for failed tasks', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'TEST_ERROR',
          message: 'Test error message',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task was updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('TEST_ERROR');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('stores error for interrupted tasks', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task was updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('interrupted');
      expect(getResult.value.error?.code).toBe('worker_interrupted');
      expect(getResult.value.callbackReceived).toBe(true);
    });

    it('stores error for cancelled tasks', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_cancelled_task_unique_775',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'cancelled' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify task was updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('cancelled');
      expect(getResult.value.error?.code).toBe('task_cancelled');
      expect(getResult.value.callbackReceived).toBe(true);
    });
  });

  describe('review task-complete → remediation creation (INT-1103)', () => {
    // Helper: create a review task in Firestore and return it
    async function createReviewTask(overrides: {
      traceId: string;
      prNumber?: number;
      agentType?: 'review' | 'remediation';
    }): Promise<import('../../domain/models/codeTask.js').CodeTask> {
      const result = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: overrides.traceId,
        prNumber: overrides.prNumber ?? 42,
        webhookSecret: 'test-webhook-secret',
        agentType: overrides.agentType ?? 'review',
      });
      if (!result.ok) throw new Error('Failed to create task');
      return result.value;
    }

    async function saveReviewEvent(reviewId: number, body: string | null): Promise<void> {
      const saveResult = await getServices().gitHubPREventRepo.save({
        githubEventId: reviewId,
        deliveryId: `delivery-review-${String(reviewId)}`,
        repository: 'pbuchman/intexuraos',
        repositoryId: 1,
        pullRequestNumber: 42,
        pullRequestId: 420,
        eventType: 'pull_request_review',
        action: 'submitted',
        senderLogin: 'intexuraos-code-worker[bot]',
        senderId: 1000,
        senderType: 'Bot',
        prAuthorLogin: 'pbuchman',
        title: null,
        body,
        state: 'open',
        baseBranch: 'development',
        mergedAt: null,
        createdAt: new Date('2026-03-27T00:00:00Z'),
        payload: {
          review: {
            id: reviewId,
            body,
          },
        },
      });
      if (!saveResult.ok) throw new Error(`Failed to save review event: ${saveResult.error.message}`);
    }

    function makeRemediationPayload(
      taskId: string,
      needs_remediation?: string,
      review_id?: string,
    ): {
      taskId: string;
      status: 'completed';
      result: {
        summary: string;
        review_comments_posted: string;
        review_types: string;
        needs_remediation?: string;
        review_id?: string;
      };
    } {
      return {
        taskId,
        status: 'completed' as const,
        result: {
          summary: 'Found 2 issues',
          review_comments_posted: '2',
          review_types: 'code_quality',
          ...(needs_remediation !== undefined && { needs_remediation }),
          ...(review_id !== undefined && { review_id }),
        },
      };
    }

    type RemediationFn = (logger: import('pino').Logger, request: CreateRemediationTaskRequest) => Promise<Result<CreateRemediationTaskResult, CreateRemediationTaskError>>;

    // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
    async function sendTaskCompleteWithRemediation(payload: object, mockCreateRemediationFn?: ReturnType<typeof vi.fn>) {
      const mockFn = mockCreateRemediationFn ?? vi.fn().mockResolvedValue(ok({ status: 'queued', taskId: 'remediation-task-1', workerType: 'auto' }));
      setServices({
        ...getServices(),
        createRemediationTaskFn: mockFn as RemediationFn,
      });

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });
      return { response, mockFn };
    }

    it('creates remediation task when needs_remediation is "1"', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_1' });
      const payload = makeRemediationPayload(task.id, '1');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
      expect(mockFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          repository: 'pbuchman/intexuraos',
          prNumber: 42,
          workerType: 'auto',
        }),
      );
      const automationLogMock = vi.mocked(getServices().automationLog.record);
      await vi.waitFor(() => {
        const decisionCall = automationLogMock.mock.calls.find(
          (call) => (call[1] as { type: string }).type === 'remediation_decision'
        );
        expect(decisionCall).toBeDefined();
      });
      const decisionCall = automationLogMock.mock.calls.find(
        (call) => (call[1] as { type: string }).type === 'remediation_decision'
      );
      expect(decisionCall).toBeDefined();
      expect(decisionCall?.[1]).toMatchObject({
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: '1',
        taskId: 'remediation-task-1',
      });
    });

    it('creates remediation task when review_id is present (no pre-loading of findings)', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_review_ctx' });
      const payload = makeRemediationPayload(task.id, '1', '777');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
      expect(mockFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          repository: 'pbuchman/intexuraos',
          prNumber: 42,
          workerType: 'auto',
        }),
      );
      // Findings are NOT pre-loaded — nitpick-nuker fetches them at runtime
      const callArg = mockFn.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('reviewBody');
      expect(callArg).not.toHaveProperty('inlineComments');
    });

    it('creates remediation task without pre-loaded findings regardless of stored review events', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_review_ctx_no_comments' });
      await saveReviewEvent(779, 'Please fix the blocking issue before merge.');
      const payload = makeRemediationPayload(task.id, '1', '779');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
      const callArg = mockFn.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('reviewBody');
      expect(callArg).not.toHaveProperty('inlineComments');
    });

    it('does NOT create remediation task when needs_remediation is "0"', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_0' });
      const payload = makeRemediationPayload(task.id, '0');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).not.toHaveBeenCalled();
      const automationLogMock = vi.mocked(getServices().automationLog.record);
      await vi.waitFor(() => {
        const decisionCall = automationLogMock.mock.calls.find(
          (call) => (call[1] as { type: string }).type === 'remediation_decision'
        );
        expect(decisionCall).toBeDefined();
      });
      const decisionCall = automationLogMock.mock.calls.find(
        (call) => (call[1] as { type: string }).type === 'remediation_decision'
      );
      expect(decisionCall?.[1]).toMatchObject({
        type: 'remediation_decision',
        required: false,
        source: 'review_result',
        signal: '0',
      });
    });

    it('creates remediation task when needs_remediation is undefined (fail-open)', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_undefined' });
      const payload = makeRemediationPayload(task.id, undefined);

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
      const automationLogMock = vi.mocked(getServices().automationLog.record);
      await vi.waitFor(() => {
        const decisionCall = automationLogMock.mock.calls.find(
          (call) => (call[1] as { type: string }).type === 'remediation_decision'
        );
        expect(decisionCall).toBeDefined();
      });
      const decisionCall = automationLogMock.mock.calls.find(
        (call) => (call[1] as { type: string }).type === 'remediation_decision'
      );
      expect(decisionCall?.[1]).toMatchObject({
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: 'missing',
        taskId: 'remediation-task-1',
      });
    });

    it('creates remediation task when review_id is absent', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_no_review_id' });
      const payload = makeRemediationPayload(task.id, '1');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
      expect(mockFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
      );
    });

    it('creates remediation task when review_id is empty', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_empty_review_id' });
      const payload = makeRemediationPayload(task.id, '1', '');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
    });

    it('creates remediation task when review_id is not numeric', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_invalid_review_id' });
      const payload = makeRemediationPayload(task.id, '1', 'not-a-number');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
    });

    it('creates remediation task when review_id is numeric (no enrichment needed)', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_numeric_review_id' });
      const payload = makeRemediationPayload(task.id, '1', '780');

      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
      expect(mockFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          repository: 'pbuchman/intexuraos',
          prNumber: 42,
          workerType: 'auto',
        }),
      );
    });

    it('does NOT create remediation task when result is absent (verification failed)', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_no_result' });
      const payload = {
        taskId: task.id,
        status: 'completed' as const,
      };

      const mockFn = vi.fn().mockResolvedValue(ok({ status: 'queued', taskId: 'rem-never', workerType: 'auto' }));
      setServices({ ...getServices(), createRemediationTaskFn: mockFn });
      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // No result → review enforcement rejects it before reaching the remediation block
      expect(response.statusCode).toBe(200);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('passes linearIssueId and baseBranch to remediation task when present on review task', async () => {
      const result = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_rem_linear',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
        linearIssueId: 'INT-999',
      });
      if (!result.ok) throw new Error('Failed to create task');
      const task = result.value;

      const payload = makeRemediationPayload(task.id, '1');
      const { response, mockFn } = await sendTaskCompleteWithRemediation(payload);

      expect(response.statusCode).toBe(200);
      expect(mockFn).toHaveBeenCalledOnce();
      expect(mockFn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          repository: 'pbuchman/intexuraos',
          prNumber: 42,
          linearIssueId: 'INT-999',
          baseBranch: 'development',
        }),
      );
    });

    it('does NOT create remediation for remediation task-complete (agentType guard)', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_guard', agentType: 'remediation' });
      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Fixed 2 issues',
          needs_remediation: '1',
        },
      };

      const mockFn = vi.fn().mockResolvedValue(ok({ status: 'queued', taskId: 'rem-never', workerType: 'auto' }));
      setServices({ ...getServices(), createRemediationTaskFn: mockFn });
      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('still returns 200 when createRemediationTaskFn returns an error (best-effort)', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_error' });
      const payload = makeRemediationPayload(task.id, '1');

      const { response } = await sendTaskCompleteWithRemediation(
        payload,
        vi.fn().mockResolvedValue(err({ code: 'task_creation_failed', message: 'Firestore error' })),
      );

      expect(response.statusCode).toBe(200);
    });

    it('still records remediation decision when createRemediationTaskFn throws unexpectedly', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_throw_missing' });
      const payload = makeRemediationPayload(task.id, undefined);

      const { response } = await sendTaskCompleteWithRemediation(
        payload,
        vi.fn().mockRejectedValue(new Error('boom')),
      );

      expect(response.statusCode).toBe(200);
      const automationLogMock = vi.mocked(getServices().automationLog.record);
      await vi.waitFor(() => {
        const decisionCall = automationLogMock.mock.calls.find(
          (call) => (call[1] as { type: string }).type === 'remediation_decision'
        );
        expect(decisionCall).toBeDefined();
      });
      const decisionCall = automationLogMock.mock.calls.find(
        (call) => (call[1] as { type: string }).type === 'remediation_decision'
      );
      expect(decisionCall?.[1]).toMatchObject({
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: 'missing',
      });
    });

    it('preserves explicit remediation signal when createRemediationTaskFn throws unexpectedly', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_throw_signal_1' });
      const payload = makeRemediationPayload(task.id, '1');

      const { response } = await sendTaskCompleteWithRemediation(
        payload,
        vi.fn().mockRejectedValue(new Error('boom')),
      );

      expect(response.statusCode).toBe(200);
      const automationLogMock = vi.mocked(getServices().automationLog.record);
      await vi.waitFor(() => {
        const decisionCall = automationLogMock.mock.calls.find(
          (call) => (call[1] as { type: string }).type === 'remediation_decision'
        );
        expect(decisionCall).toBeDefined();
      });
      const decisionCall = automationLogMock.mock.calls.find(
        (call) => (call[1] as { type: string }).type === 'remediation_decision'
      );
      expect(decisionCall?.[1]).toMatchObject({
        type: 'remediation_decision',
        required: true,
        source: 'review_result',
        signal: '1',
      });
    });

    it('still returns 200 when createRemediationTaskFn is not configured', async () => {
      const task = await createReviewTask({ traceId: 'trace_rem_no_fn' });
      const payload = makeRemediationPayload(task.id, '1');

      // Do NOT set createRemediationTaskFn — it's optional in ServiceContainer
      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('review task-complete → review-outcome labels on Linear issue', () => {
    async function createOriginTask(overrides: {
      traceId: string;
      agentType: 'planning' | 'execution' | 'pull_request';
      linearIssueId?: string;
    }): Promise<import('../../domain/models/codeTask.js').CodeTask> {
      const result = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Create a PR',
        sanitizedPrompt: 'Create a PR',
        systemPromptHash: 'origin-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: overrides.traceId,
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: overrides.agentType,
        linearIssueId: overrides.linearIssueId ?? 'INT-500',
      });
      if (!result.ok) throw new Error('Failed to create origin task');
      return result.value;
    }

    async function createReviewTaskForLabel(overrides: {
      traceId: string;
      linearIssueId?: string;
    }): Promise<import('../../domain/models/codeTask.js').CodeTask> {
      const result = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review the PR',
        sanitizedPrompt: 'Review the PR',
        systemPromptHash: 'review-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: overrides.traceId,
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
        ...(overrides.linearIssueId !== undefined && { linearIssueId: overrides.linearIssueId }),
      });
      if (!result.ok) throw new Error('Failed to create review task');
      return result.value;
    }

    function makeLabelPayload(taskId: string): {
      taskId: string;
      status: 'completed';
      result: {
        summary: string;
        review_comments_posted: string;
        review_types: string;
        needs_remediation: string;
      };
    } {
      return {
        taskId,
        status: 'completed' as const,
        result: {
          summary: 'All good',
          review_comments_posted: '0',
          review_types: 'code_quality',
          needs_remediation: '0',
        },
      };
    }

    type LabelRemediationFn = (logger: import('pino').Logger, request: CreateRemediationTaskRequest) => Promise<Result<CreateRemediationTaskResult, CreateRemediationTaskError>>;

    async function sendLabelPayload(payload: object): Promise<import('fastify').LightMyRequestResponse> {
      const mockFn = vi.fn().mockResolvedValue(ok({ status: 'queued', taskId: 'rem-never', workerType: 'auto' }));
      setServices({
        ...getServices(),
        createRemediationTaskFn: mockFn as LabelRemediationFn,
      });
      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      return app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });
    }

    it('adds ready-to-implement label when origin task is a planning task', async () => {
      await createOriginTask({ traceId: 'trace_label_planning', agentType: 'planning' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_planning_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const validateSpy = vi.mocked(lac.validateIssue);
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      expect(validateSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        identifier: 'INT-500',
      });
      expect(metadataSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        issueId: 'linear-issue-uuid',
        addLabels: ['ready-to-implement'],
      });
    });

    it('adds ready-to-merge label when origin task is an execution task', async () => {
      await createOriginTask({ traceId: 'trace_label_execution', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_execution_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      expect(metadataSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        issueId: 'linear-issue-uuid',
        addLabels: ['ready-to-merge'],
      });
    });

    it('walks past pull_request task to find planning origin and sets ready-to-implement', async () => {
      // Create planning origin task first, then a newer pull_request task on the same PR.
      // findOriginTaskByPR should skip the pull_request task and find the planning origin.
      const planningTask = await createOriginTask({ traceId: 'trace_label_pr_task_planning', agentType: 'planning' });
      // Mark planning task as completed so the Layer 3 dedup (active task for same linear issue) doesn't block
      await codeTaskRepo.update(planningTask.id, { status: 'planned' });

      // Create a newer pull_request task on the same PR
      await createOriginTask({ traceId: 'trace_label_pr_task_newer', agentType: 'pull_request' });

      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_pr_task_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      // Label SHOULD be set — findOriginTaskByPR walks past pull_request to the planning task
      const { linearAgentClient: lac } = getServices();
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      expect(metadataSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        issueId: 'linear-issue-uuid',
        addLabels: ['ready-to-implement'],
      });
    });

    it('adds ready-to-merge label when origin is a pull_request task (fallback)', async () => {
      // Create only a pull_request origin task — no planning/execution.
      // findOriginTaskByPR should return the pull_request task as fallback.
      await createOriginTask({ traceId: 'trace_label_pr_only_origin', agentType: 'pull_request' });

      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_pr_only_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const validateSpy = vi.mocked(lac.validateIssue);
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      expect(validateSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        identifier: 'INT-500',
      });
      expect(metadataSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        issueId: 'linear-issue-uuid',
        addLabels: ['ready-to-merge'],
      });
    });

    it('skips label when findOriginTaskByPR returns null', async () => {
      // No origin task created — only the review task exists
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_no_origin' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const validateSpy = vi.mocked(lac.validateIssue);
      // validateIssue should NOT be called for the label-setting path
      // (it may be called by other paths, so we check it wasn't called with INT-500)
      const labelCalls = validateSpy.mock.calls.filter(
        (call) => call[0].identifier === 'INT-500'
      );
      expect(labelCalls).toHaveLength(0);
    });

    it('skips label when origin task has no linearIssueId', async () => {
      // Create origin task without linearIssueId
      const originResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Create a PR',
        sanitizedPrompt: 'Create a PR',
        systemPromptHash: 'origin-auto',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_label_no_linear',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'execution',
        // no linearIssueId
      });
      if (!originResult.ok) throw new Error('Failed to create origin task');
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_no_linear_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      // No label update should have been attempted
      const { linearAgentClient: lac } = getServices();
      const validateSpy = vi.mocked(lac.validateIssue);
      const labelCalls = validateSpy.mock.calls.filter(
        (call) => call[0].identifier === 'INT-500'
      );
      expect(labelCalls).toHaveLength(0);
    });

    it('logs warning and succeeds when findOriginTaskByPR returns error', async () => {
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_origin_error' });
      const payload = makeLabelPayload(reviewTask.id);

      vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Simulated query error' })
      );

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      // validateIssue should NOT be called since origin lookup failed
      const { linearAgentClient: lac } = getServices();
      const validateSpy = vi.mocked(lac.validateIssue);
      const labelCalls = validateSpy.mock.calls.filter(
        (call) => call[0].identifier === 'INT-500'
      );
      expect(labelCalls).toHaveLength(0);
    });

    it('logs error and succeeds when validateIssue fails', async () => {
      await createOriginTask({ traceId: 'trace_label_validate_fail', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_validate_fail_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const { linearAgentClient: lac } = getServices();
      vi.mocked(lac.validateIssue).mockResolvedValueOnce(
        err({ code: 'NOT_FOUND' as const, message: 'Issue not found' })
      );

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      // updateIssueMetadata should NOT be called since validate failed
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      const labelCalls = metadataSpy.mock.calls.filter(
        (call) => call[0].addLabels !== undefined &&
          (call[0].addLabels.includes('ready-to-merge') || call[0].addLabels.includes('ready-to-implement'))
      );
      expect(labelCalls).toHaveLength(0);
    });

    it('logs error and succeeds when updateIssueMetadata fails', async () => {
      await createOriginTask({ traceId: 'trace_label_metadata_fail', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_metadata_fail_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const { linearAgentClient: lac } = getServices();
      vi.mocked(lac.updateIssueMetadata).mockResolvedValueOnce(
        err({ code: 'UNKNOWN' as const, message: 'Update failed' })
      );

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
    });

    it('warns and succeeds when updateIssueMetadata returns droppedLabels', async () => {
      await createOriginTask({ traceId: 'trace_label_dropped', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_dropped_review' });
      const payload = makeLabelPayload(reviewTask.id);

      const { linearAgentClient: lac } = getServices();
      vi.mocked(lac.updateIssueMetadata).mockResolvedValueOnce(
        ok({ droppedLabels: ['ready-to-merge'] })
      );

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      const labelCalls = metadataSpy.mock.calls.filter(
        (call) => call[0].addLabels !== undefined &&
          call[0].addLabels.includes('ready-to-merge')
      );
      expect(labelCalls).toHaveLength(1);
    });

    it('falls back to review task issue when no origin task exists (external PR)', async () => {
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_fallback_review', linearIssueId: 'INT-REVIEW-99' });
      vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(ok(null));

      const payload = makeLabelPayload(reviewTask.id);
      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const validateSpy = vi.mocked(lac.validateIssue);
      expect(validateSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        identifier: 'INT-REVIEW-99',
      });
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      expect(metadataSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        issueId: 'linear-issue-uuid',
        addLabels: ['ready-to-merge'],
      });
    });

    it('falls back to review task issue when origin lookup fails', async () => {
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_fallback_error', linearIssueId: 'INT-REVIEW-ERR' });
      vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Simulated query error' })
      );

      const payload = makeLabelPayload(reviewTask.id);
      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      // Should still attempt to set label on review task's issue
      const validateSpy = vi.mocked(lac.validateIssue);
      expect(validateSpy).toHaveBeenCalledWith({
        userId: 'user-123',
        identifier: 'INT-REVIEW-ERR',
      });
    });

    it('skips label when neither origin nor review task has linearIssueId', async () => {
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_no_issue_at_all' });
      // No origin task exists either
      vi.spyOn(codeTaskRepo, 'findOriginTaskByPR').mockResolvedValueOnce(ok(null));

      const payload = makeLabelPayload(reviewTask.id);
      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      // No label-related metadata update should have been attempted
      const { linearAgentClient: lac } = getServices();
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      const labelMetaCalls = metadataSpy.mock.calls.filter(
        (call) => call[0].addLabels !== undefined &&
          (call[0].addLabels.includes('ready-to-merge') || call[0].addLabels.includes('ready-to-implement'))
      );
      expect(labelMetaCalls).toHaveLength(0);
    });

    it('skips review-outcome label when PR is already merged', async () => {
      await createOriginTask({ traceId: 'trace_label_merged', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_merged_review' });

      // Simulate PR already merged by providing a gitHubPRSummaryRepo with mergedAt set
      const mockFindByPullRequest = vi.fn().mockResolvedValue(
        ok({ mergedAt: new Date('2026-04-01T09:35:00Z') })
      );
      setServices({
        ...getServices(),
        gitHubPRSummaryRepo: {
          ...getServices().gitHubPRSummaryRepo,
          findByPullRequest: mockFindByPullRequest,
        },
      });

      const payload = makeLabelPayload(reviewTask.id);
      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      // updateIssueMetadata should NOT have been called for label addition
      const labelCalls = metadataSpy.mock.calls.filter(
        (call) => call[0].addLabels !== undefined
      );
      expect(labelCalls).toHaveLength(0);
    });

    it('does NOT set labels when needs_remediation is not "0"', async () => {
      await createOriginTask({ traceId: 'trace_label_remediation', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_remediation_review' });
      const payload = {
        taskId: reviewTask.id,
        status: 'completed' as const,
        result: {
          summary: 'Found issues',
          review_comments_posted: '2',
          review_types: 'code_quality',
          needs_remediation: '1',
        },
      };

      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      const { linearAgentClient: lac } = getServices();
      const metadataSpy = vi.mocked(lac.updateIssueMetadata);
      const labelCalls = metadataSpy.mock.calls.filter(
        (call) => call[0].addLabels !== undefined &&
          (call[0].addLabels.includes('ready-to-merge') || call[0].addLabels.includes('ready-to-implement'))
      );
      expect(labelCalls).toHaveLength(0);
    });

    it('recomputes group summary after setting review-outcome label', async () => {
      await createOriginTask({ traceId: 'trace_label_summary', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_summary_review' });

      const mockRecomputeWithLabels = vi.fn().mockResolvedValue(ok(undefined));
      setServices({
        ...getServices(),
        groupSummaryRepo: {
          recomputeWithLabels: mockRecomputeWithLabels,
        } as never,
      });

      const payload = makeLabelPayload(reviewTask.id);
      const response = await sendLabelPayload(payload);

      expect(response.statusCode).toBe(200);
      expect(mockRecomputeWithLabels).toHaveBeenCalledWith(
        'user-123',
        'INT-500',
        expect.arrayContaining([
          expect.objectContaining({ name: 'ready-to-merge' }),
        ]),
        expect.any(String),
      );
    });

    it('does not throw when recomputeWithLabels fails after label set', async () => {
      await createOriginTask({ traceId: 'trace_label_summary_fail', agentType: 'execution' });
      const reviewTask = await createReviewTaskForLabel({ traceId: 'trace_label_summary_fail_review' });

      const mockRecomputeWithLabels = vi.fn().mockRejectedValue(new Error('firestore down'));
      setServices({
        ...getServices(),
        groupSummaryRepo: {
          recomputeWithLabels: mockRecomputeWithLabels,
        } as never,
      });

      const payload = makeLabelPayload(reviewTask.id);
      const response = await sendLabelPayload(payload);

      // Should complete successfully — recompute is fire-and-forget
      expect(response.statusCode).toBe(200);
    });
  });

  describe('remediation task-complete → requiresReReview persistence', () => {
    async function createRemediationTaskRecord(
      traceId: string,
      requiresReReview?: boolean,
    ): Promise<import('../../domain/models/codeTask.js').CodeTask> {
      const result = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix review findings',
        sanitizedPrompt: 'Fix review findings',
        systemPromptHash: 'remediation-auto',
        workerType: 'codex',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId,
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
        agentType: 'remediation',
      });
      if (!result.ok) throw new Error('Failed to create remediation task');
      if (requiresReReview === undefined) {
        return result.value;
      }
      const updateResult = await codeTaskRepo.update(result.value.id, { requiresReReview });
      if (!updateResult.ok) throw new Error('Failed to seed remediation requiresReReview');
      return updateResult.value;
    }

    it('writes requiresReReview from remediation result', async () => {
      const task = await createRemediationTaskRecord('trace_remediation_backfill');
      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Fixed the review findings.',
          requires_re_review: '1',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/504',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const stored = await codeTaskRepo.findById(task.id);
      expect(stored.ok).toBe(true);
      if (!stored.ok) throw new Error('Failed to get remediation task');
      expect(stored.value.requiresReReview).toBe(true);
      expect(stored.value.result?.requires_re_review).toBe('1');
    });

    it('overwrites existing requiresReReview with result value', async () => {
      const task = await createRemediationTaskRecord('trace_remediation_overwrite', false);
      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Fixed the review findings.',
          requires_re_review: '1',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/505',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const stored = await codeTaskRepo.findById(task.id);
      expect(stored.ok).toBe(true);
      if (!stored.ok) throw new Error('Failed to get remediation task');
      expect(stored.value.requiresReReview).toBe(true);
      expect(stored.value.result?.requires_re_review).toBe('1');
    });
  });

  describe('planning-agent unclear failure mapping', () => {
    it('stores failed planning unclear webhook error and preserves flattened planning result', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Need clarification',
        sanitizedPrompt: 'Need clarification',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        linearIssueId: 'INT-123',
        webhookSecret: 'test-webhook-secret',
        agentType: 'planning',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        result: {
          summary: 'Clarification needed',
          planning_outcome_label: 'unclear' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: '',
          planning_is_complex: '0' as const,
          planning_pr_url: '',
          planning_unclear_clarification: 'Missing acceptance criteria and target service',
        },
        error: {
          code: 'PLANNING_AGENT_UNCLEAR',
          message: 'Missing acceptance criteria and target service',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
      expect(getResult.value.error?.code).toBe('PLANNING_AGENT_UNCLEAR');
      expect(getResult.value.result?.planning_outcome_label).toBe('unclear');
      expect(getResult.value.result?.planning_unclear_clarification).toContain('Missing acceptance');
    });
  });

  describe('actions-agent callback', () => {
    it('calls actions-agent when task has actionId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: '550e8400-e29b-41d4-a716-446655440000',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed the bug',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
        }),
        `/internal/actions/550e8400-e29b-41d4-a716-446655440000/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            resource_status: 'completed',
            resource_result: {
              prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
            },
          }),
        })
      );
    });

    it('does not call actions-agent for tasks without actionId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        // No actionId
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed the bug',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify WhatsApp notification was sent (but not actions-agent)
      expect(mockWhatsAppPublisher.publishSendMessage).toHaveBeenCalledTimes(1);
      expect(mockWhatsAppPublisher.publishSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
        })
      );
    });

    it('calls actions-agent for completed task without prUrl', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: '660e8400-e29b-41d4-a716-446655440001',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed but no PR',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called without prUrl
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
        }),
        `/internal/actions/660e8400-e29b-41d4-a716-446655440001/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            resource_status: 'completed',
          }),
        })
      );
    });

    it('calls actions-agent for failed task with actionId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: '770e8400-e29b-41d4-a716-446655440002',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'WORKER_ERROR',
          message: 'Worker failed to process task',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called with 'failed' status
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'http://actions-agent',
          internalAuthToken: 'test-token',
        }),
        `/internal/actions/770e8400-e29b-41d4-a716-446655440002/status`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            resource_status: 'failed',
            resource_result: {
              error: 'Worker failed to process task',
            },
          }),
        })
      );
    });

    it('handles task update failure gracefully', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: '880e8400-e29b-41d4-a716-446655440003',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Mock task update to fail
      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Completed but update fails',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/999',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
        },
      });

      updateSpy.mockRestore();
    });

    it('calls actions-agent for completed task without prUrl', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: '990e8400-e29b-41d4-a716-446655440004',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      // Verify actions-agent was called with 'interrupted' status (INT-1119: statusMirrorService maps correctly)
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.any(Object),
        '/internal/actions/990e8400-e29b-41d4-a716-446655440004/status',
        expect.objectContaining({
          body: JSON.stringify({
            resource_status: 'interrupted',
            resource_result: {
              error: 'Worker was interrupted during task execution',
            },
          }),
        })
      );
    });

    it('handles actions-agent failure gracefully', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'aa0e8400-e29b-41d4-a716-446655440005',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'test-branch',
          commits: 1,
          summary: 'Fixed the bug',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      // Mock actions-agent failure
      mockFetchWithAuth.mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'NETWORK_ERROR',
          message: 'Connection refused',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Webhook still succeeds even though actions-agent callback failed
      expect(response.statusCode).toBe(200);

      // Task was still updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
    });

    it('returns 500 when update fails for failed status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-fail-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Mock update to fail
      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: { code: 'WORKER_ERROR', message: 'Worker crashed' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: 'INTERNAL_ERROR' },
      });

      updateSpy.mockRestore();
    });

    it('returns 500 when update fails for interrupted status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-interrupt-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const updateSpy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(
        err({ code: 'FIRESTORE_ERROR', message: 'Update failed' })
      );

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({
        success: false,
        error: { code: 'INTERNAL_ERROR' },
      });

      updateSpy.mockRestore();
    });

    it('continues when actions-agent fails for failed status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-fail-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      mockFetchWithAuth.mockResolvedValueOnce(
        err({ code: 'NETWORK_ERROR', message: 'Connection refused' })
      );

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: { code: 'WORKER_ERROR', message: 'Worker crashed' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      // Webhook succeeds even if actions-agent fails
      expect(response.statusCode).toBe(200);

      // Task was still updated
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('failed');
    });

    it('continues when actions-agent fails for interrupted status', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        actionId: 'action-interrupt-notify',
      });
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      mockFetchWithAuth.mockResolvedValueOnce(
        err({ code: 'NETWORK_ERROR', message: 'Connection refused' })
      );

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('interrupted');
    });
  });

  describe('Linear In Review transition', () => {
    it('calls markInReview when completed task has prUrl and linearIssueId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        linearIssueId: 'INT-500',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const services = getServices();
      const markInReviewSpy = vi.spyOn(services.linearIssueService, 'markInReview');

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/linear-transition',
          commits: 2,
          summary: 'Fixed the bug',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/500',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(markInReviewSpy).toHaveBeenCalledWith('user-123', 'INT-500');
    });

    it('does not call markInReview when completed task has prUrl but no linearIssueId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const services = getServices();
      const markInReviewSpy = vi.spyOn(services.linearIssueService, 'markInReview');

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/no-linear',
          commits: 1,
          summary: 'Fixed without Linear',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/501',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(markInReviewSpy).not.toHaveBeenCalled();
    });

    it('does not call markInReview when completed task has no prUrl', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        linearIssueId: 'INT-502',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const services = getServices();
      const markInReviewSpy = vi.spyOn(services.linearIssueService, 'markInReview');

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/no-pr',
          commits: 1,
          summary: 'Completed but no PR',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(markInReviewSpy).not.toHaveBeenCalled();
    });

    it('does not call markInReview for remediation task with linearIssueId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix review findings',
        sanitizedPrompt: 'Fix review findings',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        linearIssueId: 'INT-504',
        agentType: 'remediation',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const services = getServices();
      const markInReviewSpy = vi.spyOn(services.linearIssueService, 'markInReview');

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/remediation-fixes',
          commits: 1,
          summary: 'Fixed review findings',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/504',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(markInReviewSpy).not.toHaveBeenCalled();
    });

    it('does not call markInReview for failed task with linearIssueId', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_123',
        webhookSecret: 'test-webhook-secret',
        linearIssueId: 'INT-503',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const services = getServices();
      const markInReviewSpy = vi.spyOn(services.linearIssueService, 'markInReview');

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: {
          code: 'WORKER_ERROR',
          message: 'Worker crashed',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(markInReviewSpy).not.toHaveBeenCalled();
    });
  });

  describe('triggers drain on task completion (INT-1098)', () => {
    it('calls drainTaskQueue when completed task has prNumber', async () => {
      const mockDrain = vi.mocked(drainTaskQueueModule.drainTaskQueue);
      mockDrain.mockClear();

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug',
        sanitizedPrompt: 'Fix the bug',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_drain_1',
        prNumber: 42,
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/drain-test',
          commits: 1,
          summary: 'Test drain trigger',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received).toBe(true);
      expect(mockDrain).toHaveBeenCalledOnce();
    });

    it('does not call drainTaskQueue when completed task has no prNumber', async () => {
      const mockDrain = vi.mocked(drainTaskQueueModule.drainTaskQueue);
      mockDrain.mockClear();

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug no pr',
        sanitizedPrompt: 'Fix the bug no pr',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_drain_2',
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/no-pr-drain',
          commits: 1,
          summary: 'No PR, no drain',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received).toBe(true);
      expect(mockDrain).not.toHaveBeenCalled();
    });

    it('returns { received: true } even when drainTaskQueue throws', async () => {
      const mockDrain = vi.mocked(drainTaskQueueModule.drainTaskQueue);
      mockDrain.mockClear();
      mockDrain.mockRejectedValueOnce(new Error('drain exploded'));

      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Fix the bug drain throws',
        sanitizedPrompt: 'Fix the bug drain throws',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_drain_3',
        prNumber: 99,
        webhookSecret: 'test-webhook-secret',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          branch: 'fix/drain-throws',
          commits: 1,
          summary: 'Drain will throw',
          prUrl: 'https://github.com/pbuchman/intexuraos/pull/99',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.received).toBe(true);
      // Verify drain WAS called (so the rejection was actually exercised, not bypassed)
      expect(mockDrain).toHaveBeenCalledOnce();
    });
  });
});

describe('POST /internal/webhooks/task-complete - Metrics recording', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let mockMetricsClient: {
    incrementTasksCompleted: ReturnType<typeof vi.fn>;
    recordTaskDuration: ReturnType<typeof vi.fn>;
  };

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
    return { timestamp, signature };
  }

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    const actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    mockMetricsClient = {
      incrementTasksCompleted: vi.fn().mockResolvedValue(undefined),
      recordTaskDuration: vi.fn().mockResolvedValue(undefined),
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
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      taskDispatcher: createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe }),
      workerSettingsRepo: createWorkerSettingsRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      whatsappNotifier: createWhatsAppNotifier({
        whatsappPublisher: {
          publishSendMessage: async () => ok(undefined),
        } as unknown as WhatsAppSendPublisher,
      }),
      logChunkRepo: createFirestoreLogChunkRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      logLineRepo: createFirestoreLogLineRepository({
        firestore: fakeFirestore as unknown as Firestore,
        logger,
      }),
      actionsAgentClient,
      linearAgentClient,
      rateLimitService,
      linearIssueService,
      metricsClient: mockMetricsClient as unknown as MetricsClient,
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
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
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
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      codeTaskRepo: CodeTaskRepository;
      taskDispatcher: TaskDispatcherService;
      workerSettingsRepo: WorkerSettingsRepository;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      actionsAgentClient: ActionsAgentClient;
      linearAgentClient: LinearAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      archiveStaleGroups: import('../../domain/usecases/archiveStaleGroups.js').ArchiveStaleGroupsUseCase;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    mockMetricsClient.incrementTasksCompleted.mockClear();
    mockMetricsClient.recordTaskDuration.mockClear();
  });

  it('records completion metrics when task completes successfully', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'test-user-id',
      workerType: 'opus',
      workerLocation: 'mac',
      prompt: 'test prompt',
      sanitizedPrompt: 'test prompt',
      systemPromptHash: 'hash',
      webhookSecret: 'test-webhook-secret',
      traceId: 'trace-123',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      result: {
        branch: 'main',
        commits: 1,
        summary: 'Test summary',
      },
      duration: 45.5,
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(mockMetricsClient.incrementTasksCompleted).toHaveBeenCalledWith('opus', 'implemented');
    expect(mockMetricsClient.recordTaskDuration).toHaveBeenCalledWith('opus', 45.5);
  });

  it('records failure metrics when task fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'test-user-id',
      workerType: 'opus',
      workerLocation: 'mac',
      prompt: 'test prompt',
      sanitizedPrompt: 'test prompt',
      systemPromptHash: 'hash',
      webhookSecret: 'test-webhook-secret',
      traceId: 'trace-123',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'failed' as const,
      error: {
        code: 'WORKER_ERROR',
        message: 'Task failed',
      },
      duration: 30.2,
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(mockMetricsClient.incrementTasksCompleted).toHaveBeenCalledWith('opus', 'failed');
    expect(mockMetricsClient.recordTaskDuration).toHaveBeenCalledWith('opus', 30.2);
  });

  it('records interrupted metrics when task is interrupted', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'test-user-id',
      workerType: 'auto',
      workerLocation: 'vm',
      prompt: 'test prompt',
      sanitizedPrompt: 'test prompt',
      systemPromptHash: 'hash',
      webhookSecret: 'test-webhook-secret',
      traceId: 'trace-123',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'interrupted' as const,
      duration: 15.0,
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(mockMetricsClient.incrementTasksCompleted).toHaveBeenCalledWith('auto', 'interrupted');
    expect(mockMetricsClient.recordTaskDuration).toHaveBeenCalledWith('auto', 15.0);
  });

  it('does not record duration when not provided in payload', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'test-user-id',
      workerType: 'opus',
      workerLocation: 'mac',
      prompt: 'test prompt',
      sanitizedPrompt: 'test prompt',
      systemPromptHash: 'hash',
      webhookSecret: 'test-webhook-secret',
      traceId: 'trace-123',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      result: {
        branch: 'main',
        commits: 1,
        summary: 'Test summary',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(mockMetricsClient.incrementTasksCompleted).toHaveBeenCalledWith('opus', 'implemented');
    expect(mockMetricsClient.recordTaskDuration).not.toHaveBeenCalled();
  });
});

describe('POST /internal/logs', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let logChunkRepo: LogChunkRepository;
  let logLineRepo: LogLineRepository;
  let taskDispatcher: TaskDispatcherService;

  beforeEach(async () => {
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
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logLineRepo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    taskDispatcher = createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe });
    const workerSettingsRepo = createWorkerSettingsRepository({
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

    const statusMirrorService = createStatusMirrorService({
      actionsAgentClient,
      logger,
    });

    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    });

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      logChunkRepo,
      logLineRepo,
      taskDispatcher,
      workerSettingsRepo,
      actionsAgentClient,
      linearAgentClient,
      rateLimitService,
      linearIssueService,
      statusMirrorService,
      whatsappNotifier,
      metricsClient: createNoOpMetricsClient(),
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
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
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
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      codeTaskRepo: CodeTaskRepository;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      taskDispatcher: TaskDispatcherService;
      workerSettingsRepo: WorkerSettingsRepository;
      actionsAgentClient: ActionsAgentClient;
      linearAgentClient: LinearAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      archiveStaleGroups: import('../../domain/usecases/archiveStaleGroups.js').ArchiveStaleGroupsUseCase;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    return { timestamp, signature };
  }

  it('stores log chunks correctly', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    // Mock storeBatch for log chunk storage
    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: 'First log line',
          timestamp: new Date().toISOString(),
        },
        {
          sequence: 2,
          content: 'Second log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.received).toBe(true);
    expect(body.acknowledgedSequences).toEqual([1, 2]);
    expect(body.count).toBe(2);
  });

  it('accepts an empty chunk batch without storing formatted lines', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_empty_logs_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));
    const entryStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');

    const payload = {
      taskId: task.id,
      chunks: [],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(entryStoreSpy).not.toHaveBeenCalled();
  });

  it('accepts an empty chunk batch even when runtime lookup falls back transiently', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_empty_logs_fallback_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const originalFindById = codeTaskRepo.findById.bind(codeTaskRepo);
    const findByIdSpy = vi.spyOn(codeTaskRepo, 'findById');
    findByIdSpy
      .mockResolvedValueOnce(ok(task))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'transient lookup failure' }))
      .mockImplementation(originalFindById);

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));
    const entryStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');

    const payload = {
      taskId: task.id,
      chunks: [],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(entryStoreSpy).not.toHaveBeenCalled();
  });

  it('stores formatted log lines alongside raw chunks', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));
    const entryStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');

    const jsonContent = [
      JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-4-6', tools: ['Read', 'Write'] }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } }),
    ].join('\n') + '\n';

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: jsonContent,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(entryStoreSpy).toHaveBeenCalledOnce();
    const storedEntries = entryStoreSpy.mock.calls[0]?.[1];
    expect(storedEntries).toHaveLength(2);
    expect(storedEntries?.[0]?.text).toBe('[init] Model: claude-opus-4-6 | Tools: 2');
    expect(storedEntries?.[1]?.text).toBe('[claude] Hello');
  });

  it('stores raw Codex JSON log lines without Claude formatting', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Review the PR',
      sanitizedPrompt: 'Review the PR',
      systemPromptHash: 'default',
      workerType: 'codex',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_codex_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));
    const entryStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');

    const jsonContent = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'READY' },
    }) + '\n';

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: jsonContent,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(entryStoreSpy).toHaveBeenCalledOnce();
    const storedEntries = entryStoreSpy.mock.calls[0]?.[1];
    expect(storedEntries).toHaveLength(1);
    expect(storedEntries?.[0]?.text).toBe(jsonContent.trimEnd());
  });

  it('does not cache the Claude fallback when runtime lookup fails transiently for a Codex task', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Review the PR',
      sanitizedPrompt: 'Review the PR',
      systemPromptHash: 'default',
      workerType: 'codex',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_codex_runtime_retry_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const originalFindById = codeTaskRepo.findById.bind(codeTaskRepo);
    const findByIdSpy = vi.spyOn(codeTaskRepo, 'findById');
    findByIdSpy
      .mockResolvedValueOnce(ok(task))
      .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'transient lookup failure' }))
      .mockImplementation(originalFindById);

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));
    const entryStoreSpy = vi.spyOn(logLineRepo, 'storeBatch');

    const firstJson = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'FIRST' },
    }) + '\n';
    const firstPayload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: firstJson,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const firstSig = generateWebhookSignature(firstPayload, 'test-webhook-secret');

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': firstSig.timestamp,
        'x-request-signature': firstSig.signature,
      },
      payload: firstPayload,
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(entryStoreSpy.mock.calls[0]?.[1]?.[0]?.text).toBe('[event] item.completed');

    const secondJson = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'SECOND' },
    }) + '\n';
    const secondPayload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 2,
          content: secondJson,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    const secondSig = generateWebhookSignature(secondPayload, 'test-webhook-secret');

    const secondResponse = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': secondSig.timestamp,
        'x-request-signature': secondSig.signature,
      },
      payload: secondPayload,
    });

    expect(secondResponse.statusCode).toBe(200);
    expect(entryStoreSpy.mock.calls[1]?.[1]?.[0]?.text).toBe(secondJson.trimEnd());
  });

  it('validates HMAC signature', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: 'Log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-request-signature': 'invalid-signature',
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it('handles storeBatch failure', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: 'Log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    // Mock storeBatch to fail
    const storeSpy = vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Database unavailable' })
    );

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');

    storeSpy.mockRestore();
  });

  it('handles logLineRepo storeBatch failure with error-level logging', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const jsonContent = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-4-6' });

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: jsonContent,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    // Mock logLineRepo.storeBatch to fail
    const entryStoreSpy = vi.spyOn(logLineRepo, 'storeBatch').mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'Database unavailable' })
    );

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    // Response should still be 200 (raw chunks stored as fallback)
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.received).toBe(true);

    // The repository unit test verifies error logging at the correct level
    entryStoreSpy.mockRestore();
  });

  it('rejects logs for non-existent task', async () => {
    const payload = {
      taskId: 'non-existent-task-id',
      chunks: [
        {
          sequence: 1,
          content: 'Log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects logs without internal auth header', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 1,
          content: 'Log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns UNKNOWN_TASK when findById fails during HMAC secret lookup for logs (L1387)', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_logs_189',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    // Mock findById to fail (simulate DB error during HMAC secret lookup)
    const spy = vi.spyOn(codeTaskRepo, 'findById').mockResolvedValueOnce(
      err({ code: 'FIRESTORE_ERROR', message: 'DB unavailable' })
    );

    const payload = {
      taskId: task.id,
      chunks: [
        { sequence: 1, content: 'Log line', timestamp: new Date().toISOString() },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error.code).toBe('UNKNOWN_TASK');
    spy.mockRestore();
  });

  it('updates task from dispatched to running on first log chunk', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
      actionId: 'action-first-log',
      initialStatus: 'dispatched',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    vi.spyOn(logChunkRepo, 'storeBatch').mockResolvedValueOnce(ok(undefined));

    const payload = {
      taskId: task.id,
      chunks: [
        {
          sequence: 0,
          content: 'First log line',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/logs',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const getResult = await codeTaskRepo.findById(task.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) throw new Error('Failed to get task');
    expect(getResult.value.status).toBe('running');
  });
});

describe('POST /internal/webhooks/task-complete - WhatsApp notifications', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;
  let actionsAgentClient: ActionsAgentClient;
  let mockWhatsAppPublisher: { publishSendMessage: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const logLineRepo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    taskDispatcher = createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe });
    const workerSettingsRepo = createWorkerSettingsRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });
    mockWhatsAppPublisher = {
      publishSendMessage: vi.fn().mockResolvedValue(ok(undefined)),
    };
    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: mockWhatsAppPublisher as unknown as WhatsAppSendPublisher,
    });

    actionsAgentClient = createActionsAgentClient({
      baseUrl: 'http://actions-agent',
      internalAuthToken: 'test-token',
      logger,
    });

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);

    const linearIssueService = createLinearIssueService({
      linearAgentClient,
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

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      logChunkRepo,
      logLineRepo,
      taskDispatcher,
      workerSettingsRepo,
      whatsappNotifier,
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
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
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
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      codeTaskRepo: CodeTaskRepository;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      taskDispatcher: TaskDispatcherService;
      workerSettingsRepo: WorkerSettingsRepository;
      actionsAgentClient: ActionsAgentClient;
      linearAgentClient: LinearAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      archiveStaleGroups: import('../../domain/usecases/archiveStaleGroups.js').ArchiveStaleGroupsUseCase;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');

    return { timestamp, signature };
  }

  it('sends WhatsApp notification when task completes without result', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Investigate the deployment issue',
      sanitizedPrompt: 'Investigate the deployment issue',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    // Verify task was updated to completed
    const getResult = await codeTaskRepo.findById(task.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) throw new Error('Failed to get task');
    expect(getResult.value.status).toBe('implemented');
    expect(getResult.value.callbackReceived).toBe(true);

    // Verify WhatsApp notification was sent
    expect(mockWhatsAppPublisher.publishSendMessage).toHaveBeenCalledTimes(1);
    const publishCall = mockWhatsAppPublisher.publishSendMessage.mock.calls[0];
    expect(publishCall).toBeDefined();
    const params = publishCall?.[0] as { userId: string; message: string } | undefined;
    expect(params?.userId).toBe('user-123');
    expect(params?.message).toContain('✅');
  });

  it('sends WhatsApp notification on task completion', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      result: {
        branch: 'fix/login-bug',
        commits: 3,
        summary: 'Fixed login redirect handling',
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/123',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    expect(mockWhatsAppPublisher.publishSendMessage).toHaveBeenCalledTimes(1);
    const publishCall = mockWhatsAppPublisher.publishSendMessage.mock.calls[0];
    expect(publishCall).toBeDefined();
    const params = publishCall?.[0] as { userId: string; message: string; ctaUrl?: { displayText: string; url: string } } | undefined;
    expect(params?.userId).toBe('user-123');
    expect(params?.message).toContain('✅');
    expect(params?.message).toContain('fix/login-bug');
    expect(params?.message).not.toContain('PR:');
    expect(params?.ctaUrl).toEqual({
      displayText: 'View Pull Request',
      url: 'https://github.com/pbuchman/intexuraos/pull/123',
    });
    expect(params?.message).toContain('Fixed login redirect handling');
  });

  it('sends WhatsApp notification on task failure', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'failed' as const,
      error: {
        code: 'TEST_ERROR',
        message: 'Test error occurred',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    expect(mockWhatsAppPublisher.publishSendMessage).toHaveBeenCalledTimes(1);
    const publishCall = mockWhatsAppPublisher.publishSendMessage.mock.calls[0];
    expect(publishCall).toBeDefined();
    const params = publishCall?.[0] as { userId: string; message: string } | undefined;
    expect(params?.userId).toBe('user-123');
    expect(params?.message).toContain('❌');
  });

  it('sends WhatsApp notification on interrupted status', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'interrupted' as const,
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    expect(mockWhatsAppPublisher.publishSendMessage).toHaveBeenCalledTimes(1);
    const publishCall = mockWhatsAppPublisher.publishSendMessage.mock.calls[0];
    expect(publishCall).toBeDefined();
    const params = publishCall?.[0] as { userId: string; message: string } | undefined;
    expect(params?.userId).toBe('user-123');
    expect(params?.message).toContain('❌');
  });

  it('continues even if WhatsApp notification fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the login bug',
      sanitizedPrompt: 'Fix the login bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_123',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      result: {
        branch: 'fix/login-bug',
        commits: 3,
        summary: 'Fixed login redirect handling',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    // Mock WhatsApp notification to fail
    mockWhatsAppPublisher.publishSendMessage.mockResolvedValueOnce(
      err({ code: 'NETWORK_ERROR', message: 'Connection failed' })
    );

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    // Webhook should still succeed even if notification fails
    expect(response.statusCode).toBe(200);
  });

  it('sends 🔁 session-continued notification when resumedCompletion is true', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Implement the new feature',
      sanitizedPrompt: 'Implement the new feature',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_resumed',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      resumedCompletion: true,
      result: {
        branch: 'fix/resumed-branch',
        commits: 1,
        summary: 'Claude fixed the auth redirect.',
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/500',
      },
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    expect(mockWhatsAppPublisher.publishSendMessage).toHaveBeenCalledTimes(1);
    const publishCall = mockWhatsAppPublisher.publishSendMessage.mock.calls[0];
    const params = publishCall?.[0] as { userId: string; message: string };
    expect(params.userId).toBe('user-123');
    expect(params.message).toContain('🔁');
    expect(params.message).toContain('Implement the new feature');
    expect(params.message).not.toContain('✅');
  });

  it('sends standard completion notification when resumedCompletion is false', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123',
      prompt: 'Fix the bug',
      sanitizedPrompt: 'Fix the bug',
      systemPromptHash: 'default',
      workerType: 'auto',
      workerLocation: 'mac',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      traceId: 'trace_not_resumed',
      webhookSecret: 'test-webhook-secret',
    });

    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed to create task');
    const task = createResult.value;

    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      resumedCompletion: false,
    };

    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-complete',
      headers: {
        'x-internal-auth': 'test-internal-token',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);

    const publishCall = mockWhatsAppPublisher.publishSendMessage.mock.calls[0];
    const params = publishCall?.[0] as { message: string };
    expect(params.message).toContain('✅');
    expect(params.message).not.toContain('🔁');
  });

  describe('stale callback handling for cancelled tasks', () => {
    it('ignores completed callback for already cancelled task', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review task',
        sanitizedPrompt: 'Review task',
        systemPromptHash: 'review-auto',
        workerType: 'sonnet',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_cancelled',
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Cancel the task first
      await codeTaskRepo.update(task.id, {
        status: 'cancelled',
        completedAt: new Date(),
        error: { code: 'review_replaced', message: 'Review was replaced' },
      });

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Review completed',
          review_comments_posted: '3',
          review_types: 'code_quality',
        },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });

      // Verify task is still cancelled
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('cancelled');
    });

    it('ignores failed callback for already cancelled task', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review task',
        sanitizedPrompt: 'Review task',
        systemPromptHash: 'review-auto',
        workerType: 'opus',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_cancelled_fail',
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Cancel the task first
      await codeTaskRepo.update(task.id, {
        status: 'cancelled',
        completedAt: new Date(),
        error: { code: 'review_replaced', message: 'Review was replaced' },
      });

      const payload = {
        taskId: task.id,
        status: 'failed' as const,
        error: { code: 'TIMEOUT', message: 'Review timed out' },
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });

      // Verify task is still cancelled
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('cancelled');
    });

    it('ignores interrupted callback for already cancelled task', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review task',
        sanitizedPrompt: 'Review task',
        systemPromptHash: 'review-auto',
        workerType: 'minimax',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_cancelled_interrupt',
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Cancel the task first
      await codeTaskRepo.update(task.id, {
        status: 'cancelled',
        completedAt: new Date(),
        error: { code: 'review_replaced', message: 'Review was replaced' },
      });

      const payload = {
        taskId: task.id,
        status: 'interrupted' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });

      // Verify task is still cancelled
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('cancelled');
    });

    it('ignores duplicate cancelled callback', async () => {
      const createResult = await codeTaskRepo.create({
        userId: 'user-123',
        prompt: 'Review task',
        sanitizedPrompt: 'Review task',
        systemPromptHash: 'review-auto',
        workerType: 'qwen',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_cancelled_dup',
        webhookSecret: 'test-webhook-secret',
        agentType: 'review',
      });

      expect(createResult.ok).toBe(true);
      if (!createResult.ok) throw new Error('Failed to create task');
      const task = createResult.value;

      // Cancel the task first
      await codeTaskRepo.update(task.id, {
        status: 'cancelled',
        completedAt: new Date(),
        error: { code: 'review_replaced', message: 'Review was replaced' },
      });

      const payload = {
        taskId: task.id,
        status: 'cancelled' as const,
      };

      const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/internal/webhooks/task-complete',
        headers: {
          'x-internal-auth': 'test-internal-token',
          'x-request-timestamp': timestamp,
          'x-request-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ received: true });

      // Verify task is still cancelled
      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('cancelled');
    });
  });
});

describe('POST /internal/webhooks/task-complete - Additional branch coverage', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;

  function generateWebhookSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
    return { timestamp, signature };
  }

  beforeEach(async () => {
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
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
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

    const linearAgentClient = createLinearAgentHttpClient({
      baseUrl: 'http://linear-agent:8086',
      internalAuthToken: 'test-token',
      timeoutMs: 10000,
    }, logger);
    vi.spyOn(linearAgentClient, 'validateIssue').mockResolvedValue(
      ok({
        id: 'linear-issue-uuid',
        identifier: 'INT-123',
        title: 'Test issue',
        url: 'https://linear.app/pbuchman/issue/INT-123',
        labels: [],
        childCount: 0,
        parentId: null,
      })
    );
    vi.spyOn(linearAgentClient, 'fetchIssueTree').mockResolvedValue(
      ok({
        root: {
          id: 'linear-issue-uuid',
          identifier: 'INT-999',
          url: 'https://linear.app/pbuchman/issue/INT-999',
          parentId: 'linear-issue-uuid',
          labels: [],
          assigneeId: null,
          state: 'Backlog',
        },
        descendants: [],
      })
    );
    vi.spyOn(linearAgentClient, 'fetchDirectChildrenLive').mockResolvedValue(ok([]));
    vi.spyOn(linearAgentClient, 'updateIssueMetadata').mockResolvedValue(ok({ droppedLabels: [] }));
    vi.spyOn(linearAgentClient, 'addComment').mockResolvedValue(ok({ commentId: 'comment-1' }));
    vi.spyOn(linearAgentClient, 'updateIssueState').mockResolvedValue(ok(undefined));

    const linearIssueService = createLinearIssueService({ linearAgentClient, logger });
    const rateLimitService: RateLimitService = {
      async checkLimits() { return ok(undefined); },
      async recordTaskStart() { return; },
      async recordTaskComplete() { return; },
    };
    const mockWhatsAppPublisher = { publishSendMessage: vi.fn().mockResolvedValue(ok(undefined)) };
    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: mockWhatsAppPublisher as unknown as WhatsAppSendPublisher,
    });

    vi.mocked(fetchWithAuth).mockResolvedValue(ok(undefined));

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo,
      logChunkRepo,
      logLineRepo,
      taskDispatcher: createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe }),
      workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      whatsappNotifier,
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
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
      gitHubPRSummaryRepo: {} as never,
      turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      codeTaskRepo: CodeTaskRepository;
      logChunkRepo: LogChunkRepository;
      logLineRepo: LogLineRepository;
      taskDispatcher: TaskDispatcherService;
      workerSettingsRepo: WorkerSettingsRepository;
      actionsAgentClient: ActionsAgentClient;
      linearAgentClient: LinearAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      archiveStaleGroups: import('../../domain/usecases/archiveStaleGroups.js').ArchiveStaleGroupsUseCase;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  it('fails planning enforcement when linearIssueId is undefined', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'Plan without linear', sanitizedPrompt: 'Plan without linear',
      systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'trace_no_linear',
      webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;

    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '0' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });

    expect(response.statusCode).toBe(200);
    const getResult = await codeTaskRepo.findById(task.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) throw new Error('Failed');
    expect(getResult.value.status).toBe('failed');
    expect(getResult.value.error?.message).toContain('linearIssueId');
  });

  it('fails planning enforcement when validateIssue fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'Plan validate fail', sanitizedPrompt: 'Plan validate fail',
      systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'trace_validate_fail',
      linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;

    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'Linear down' }));

    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '0' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });

    expect(response.statusCode).toBe(200);
    const getResult = await codeTaskRepo.findById(task.id);
    expect(getResult.ok).toBe(true);
    if (!getResult.ok) throw new Error('Failed');
    expect(getResult.value.status).toBe('failed');
    expect(getResult.value.error?.message).toContain('Failed to validate original issue');
  });

  it('fails planning when subtask validation fails via URL-based resolution', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't1', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null })).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-200/sub', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.status).toBe('failed');
    expect(g.value.error?.message).toContain('Failed to validate subtask');
  });

  it('fails planning when subtask is not a direct child in URL-based resolution', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't2', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null })).mockResolvedValueOnce(ok({ id: 'child-uuid', identifier: 'INT-200', title: 'C', url: 'u', labels: [], childCount: 0, parentId: 'wrong-parent' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-200/sub', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('not a direct child');
  });

  it('fails planning when subtask state normalization fails in URL path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't3', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null })).mockResolvedValueOnce(ok({ id: 'child-uuid', identifier: 'INT-200', title: 'C', url: 'u', labels: [], childCount: 0, parentId: 'original-uuid' }));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValueOnce(ok(undefined)).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'state fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-200/sub', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to normalize subtask');
  });

  it('fails planning when subtask metadata normalization fails in URL path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't4', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null })).mockResolvedValueOnce(ok({ id: 'child-uuid', identifier: 'INT-200', title: 'C', url: 'u', labels: [], childCount: 0, parentId: 'original-uuid' }));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValue(ok(undefined));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValueOnce(ok({ droppedLabels: [] })).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'meta fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-200/sub', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to normalize subtask');
  });

  it('fails planning when PR comment fails in URL-based subtask path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't5', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null })).mockResolvedValueOnce(ok({ id: 'child-uuid', identifier: 'INT-200', title: 'C', url: 'u', labels: [], childCount: 0, parentId: 'original-uuid' }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'comment fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: 'https://linear.app/pbuchman/issue/INT-200/sub', planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/999' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to comment planning PR');
  });

  it('fails planning when fetchDirectChildrenLive fails in fallback', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't6', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null }));
    vi.mocked(lac.fetchDirectChildrenLive).mockReset();
    vi.mocked(lac.fetchDirectChildrenLive).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'children fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to fetch live direct children');
  });

  it('fails planning when subtask state normalization fails in fallback path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't7', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null }));
    vi.mocked(lac.fetchDirectChildrenLive).mockReset();
    vi.mocked(lac.fetchDirectChildrenLive).mockResolvedValueOnce(ok([{ id: 'c', identifier: 'INT-200', url: 'u', parentId: 'original-uuid', labels: [], assigneeId: null, state: 'IP' }]));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValueOnce(ok(undefined)).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'state fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to normalize subtask');
  });

  it('fails planning when subtask metadata normalization fails in fallback path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't8', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null }));
    vi.mocked(lac.fetchDirectChildrenLive).mockReset();
    vi.mocked(lac.fetchDirectChildrenLive).mockResolvedValueOnce(ok([{ id: 'c', identifier: 'INT-200', url: 'u', parentId: 'original-uuid', labels: [], assigneeId: null, state: 'IP' }]));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValue(ok(undefined));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValueOnce(ok({ droppedLabels: [] })).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'meta fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to normalize subtask');
  });

  it('fails planning when PR comment fails in fallback path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't9', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 1, parentId: null }));
    vi.mocked(lac.fetchDirectChildrenLive).mockReset();
    vi.mocked(lac.fetchDirectChildrenLive).mockResolvedValueOnce(ok([{ id: 'c', identifier: 'INT-200', url: 'u', parentId: 'original-uuid', labels: [], assigneeId: null, state: 'IP' }]));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValue(ok(undefined));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValue(ok({ droppedLabels: [] }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'comment fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '1' as const, planning_subtask_urls: '', planning_pr_url: 'https://github.com/pbuchman/intexuraos/pull/42' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to comment planning PR');
  });

  it('fails planning when code-task label stamp fails in simple path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't10', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValue(ok(undefined));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValueOnce(ok({ droppedLabels: [] })).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'stamp fail' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '0' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to add code-task label');
  });

  it('unclear planning uses task error message as fallback', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't11', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValue(ok({ commentId: 'c1' }));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValue(ok({ droppedLabels: [] }));
    const payload = { taskId: task.id, status: 'failed' as const, result: { planning_outcome_label: 'unclear' as const }, error: { code: 'PLANNING_AGENT_UNCLEAR', message: 'Ambiguous reqs' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    expect(vi.mocked(lac.addComment)).toHaveBeenCalledWith(expect.objectContaining({ body: 'Ambiguous reqs' }));
  });

  it('fails unclear planning when addComment fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't12', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'failed' as const, result: { planning_outcome_label: 'unclear' as const, planning_unclear_clarification: 'Need details' }, error: { code: 'PLANNING_AGENT_UNCLEAR', message: 'Unclear' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to comment unclear clarification');
  });

  it('fails unclear planning when label update fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't13', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'original-uuid', identifier: 'INT-123', title: 'O', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValue(ok({ commentId: 'c1' }));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'labels fail' }));
    const payload = { taskId: task.id, status: 'failed' as const, result: { planning_outcome_label: 'unclear' as const, planning_unclear_clarification: 'Need details' }, error: { code: 'PLANNING_AGENT_UNCLEAR', message: 'Unclear' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to enforce unclear labels');
  });

  it('fails execution enforcement when linearIssueId is undefined', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't14', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const, execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.code).toBe('EXECUTION_AGENT_ENFORCEMENT_FAILED');
  });

  it('fails already_completed enforcement when validateIssue fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't15', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { execution_outcome_label: 'already_completed' as const, summary: 'done' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.code).toBe('EXECUTION_AGENT_ENFORCEMENT_FAILED');
  });

  it('fails execution missing execution_linear_issue_url', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't16', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.code).toBe('EXECUTION_AGENT_WRONG_ISSUE_MISMATCH');
  });

  it('fails execution when routed issue validation fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't17', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const, execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to validate routed issue');
  });

  it('fails execution when execution_linear_issue_url is unparseable', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't18', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(ok({ id: 'uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const, execution_linear_issue_url: 'https://not-linear.com/bogus' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Invalid execution_linear_issue_url');
  });

  it('fails execution when reported issue validation fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't19', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const v = vi.mocked(getServices().linearAgentClient.validateIssue);
    v.mockReset();
    v.mockResolvedValueOnce(ok({ id: 'uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null })).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const, execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-456' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to validate execution-reported issue');
  });

  it('fails execution when addComment fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't20', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValue(ok({ id: 'uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const, execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to comment executed issue');
  });

  it('fails execution when updateIssueState (markReview) fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't21', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValue(ok({ id: 'uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValue(ok({ commentId: 'c1' }));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const, execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to move executed issue to In Review');
  });

  it('fails execution when updateIssueMetadata fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't22', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValue(ok({ id: 'uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValue(ok({ commentId: 'c1' }));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValue(ok(undefined));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const, execution_linear_issue_url: 'https://linear.app/pbuchman/issue/INT-123' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to preserve code-task label');
  });

  it('fails pull_request enforcement when linearIssueId is undefined', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't23', webhookSecret: 'test-webhook-secret', agentType: 'pull_request',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', comment_replied: true } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.code).toBe('PULL_REQUEST_AGENT_ENFORCEMENT_FAILED');
  });

  it('fails pull_request enforcement when validateIssue fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't24', linearIssueId: 'INT-456', webhookSecret: 'test-webhook-secret', agentType: 'pull_request',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', comment_replied: true } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to validate routed issue');
  });

  it('fails pull_request enforcement when addComment fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't25', linearIssueId: 'INT-456', webhookSecret: 'test-webhook-secret', agentType: 'pull_request',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(ok({ id: 'uuid', identifier: 'INT-456', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(getServices().linearAgentClient.addComment).mockReset();
    vi.mocked(getServices().linearAgentClient.addComment).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', comment_replied: true } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to comment on issue');
  });

  it('fails pull_request enforcement when updateIssueState fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't26', linearIssueId: 'INT-456', webhookSecret: 'test-webhook-secret', agentType: 'pull_request',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(ok({ id: 'uuid', identifier: 'INT-456', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(getServices().linearAgentClient.addComment).mockReset();
    vi.mocked(getServices().linearAgentClient.addComment).mockResolvedValue(ok({ commentId: 'c1' }));
    vi.mocked(getServices().linearAgentClient.updateIssueState).mockReset();
    vi.mocked(getServices().linearAgentClient.updateIssueState).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', comment_replied: true } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('Failed to move issue to In Review');
  });

  it('fails review enforcement when review_comments_posted is missing', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't27', webhookSecret: 'test-webhook-secret', agentType: 'review',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const, result: { review_types: 'code_quality' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.code).toBe('REVIEW_AGENT_ENFORCEMENT_FAILED');
  });

  it('fails review enforcement when review_comments_posted is not numeric', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't28', webhookSecret: 'test-webhook-secret', agentType: 'review',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const, result: { review_comments_posted: 'abc', review_types: 'code_quality' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('non-negative integer');
  });

  it('fails execution when result is missing (no payload)', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't29', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('missing result payload');
  });

  it('fails planning when result is missing (no payload)', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't30', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.code).toBe('PLANNING_AGENT_ENFORCEMENT_FAILED');
  });

  it('fails review when result is missing (no payload)', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't31', webhookSecret: 'test-webhook-secret', agentType: 'review',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.message).toContain('missing result payload');
  });

  it('handles cancelled status with actionId and actions-agent failure and duration', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't32', webhookSecret: 'test-webhook-secret', actionId: 'action-cancel',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(err({ code: 'NETWORK_ERROR' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'cancelled' as const, duration: 10 };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.status).toBe('cancelled');
  });

  it('handles cancelled status with actionId and actions-agent success', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't32b', webhookSecret: 'test-webhook-secret', actionId: 'action-cancel-ok',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(fetchWithAuth).mockResolvedValueOnce(ok({ data: { success: true } }));
    const payload = { taskId: task.id, status: 'cancelled' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
  });

  it('returns 500 when update fails for cancelled status', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't33', webhookSecret: 'test-webhook-secret',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'fail' }));
    const payload = { taskId: task.id, status: 'cancelled' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  it('unclear enforcement failure on failed webhook preserves enforcement error', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't34', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'failed' as const, result: { planning_outcome_label: 'unclear' as const, planning_unclear_clarification: 'need details' }, error: { code: 'PLANNING_AGENT_UNCLEAR', message: 'Unclear' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.error?.code).toBe('PLANNING_AGENT_ENFORCEMENT_FAILED');
  });

  it('planning task with non-planned outcome skips enforcement', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't35', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const, result: { summary: 'No outcome label' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.status).toBe('planned');
  });

  it('continues when planning design-complete notification fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't36', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValue(ok({ id: 'uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.spyOn(getServices().whatsappNotifier, 'notifyDesignComplete').mockResolvedValueOnce(err({ code: 'notification_failed' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '0' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
  });

  it('continues when resumed task-complete notification fails', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 't37', webhookSecret: 'test-webhook-secret',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.spyOn(getServices().whatsappNotifier, 'notifyResumedTaskComplete').mockResolvedValueOnce(err({ code: 'notification_failed' as const, message: 'down' }));
    const payload = { taskId: task.id, status: 'completed' as const, resumedCompletion: true, result: { summary: 'Done' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
  });

  // L747: execution missing result + codeTaskRepo.update fails
  it('returns 500 when execution enforcement update fails for missing result', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx1', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L785: execution enforcement update fails
  it('returns 500 when execution enforcement update fails for mismatch', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx2', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', execution_outcome_label: 'implemented' as const } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L817: pull_request missing result + update fails
  it('returns 500 when pull_request enforcement update fails for missing result', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx3', linearIssueId: 'INT-456', webhookSecret: 'test-webhook-secret', agentType: 'pull_request',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L855: pull_request enforcement update fails
  it('returns 500 when pull_request enforcement update fails for invalid result', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx4', webhookSecret: 'test-webhook-secret', agentType: 'pull_request',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42', comment_replied: true } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L887: planning missing result + update fails
  it('returns 500 when planning enforcement update fails for missing result', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx5', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L909: planning enforcement update fails for planned outcome
  it('returns 500 when planning enforcement update fails for planned outcome', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx6', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    // No linearIssueId -> enforcement fails, then update also fails
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { planning_outcome_label: 'planned' as const, planning_is_complex: '0' as const, planning_subtask_urls: '', planning_pr_url: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L934: review missing result + update fails
  it('returns 500 when review enforcement update fails for missing result', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx7', webhookSecret: 'test-webhook-secret', agentType: 'review',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L972: review enforcement update fails for invalid result
  it('returns 500 when review enforcement update fails for enforcement failure', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx8', webhookSecret: 'test-webhook-secret', agentType: 'review',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'completed' as const, result: { review_comments_posted: '0', review_types: '' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L1114: unclear enforcement failure + update fails in failed webhook path
  it('returns 500 when unclear enforcement update fails in failed path', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx9', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    vi.mocked(getServices().linearAgentClient.validateIssue).mockReset();
    vi.mocked(getServices().linearAgentClient.validateIssue).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));
    const spy = vi.spyOn(codeTaskRepo, 'update').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'update failed' }));
    const payload = { taskId: task.id, status: 'failed' as const, result: { planning_outcome_label: 'unclear' as const }, error: { code: 'PLANNING_AGENT_UNCLEAR', message: 'Unclear' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
    spy.mockRestore();
  });

  // L34: recordTaskFailed records automation log when task has prNumber and dispatchedAt
  it('records task_failed automation log for PR-linked dispatched task (L34)', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'trace_l34', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
      prNumber: 42, initialStatus: 'dispatched',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;

    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(err({ code: 'UNAVAILABLE' as const, message: 'down' }));

    const payload = { taskId: task.id, status: 'completed' as const, result: { execution_outcome_label: 'already_completed' as const, summary: 'done' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);

    // Wait for fire-and-forget automation log call
    const automationLogMock = vi.mocked(getServices().automationLog.record);
    await vi.waitFor(() => {
      const failedCall = automationLogMock.mock.calls.find(
        (c) => (c[1] as { type: string }).type === 'task_failed'
      );
      expect(failedCall).toBeDefined();
    });

    // Verify automation log was called with the task_failed type
    const failedCall = automationLogMock.mock.calls.find(
      (c) => (c[1] as { type: string }).type === 'task_failed'
    );
    expect(failedCall).toBeDefined();
    if (failedCall !== undefined) {
      expect((failedCall[1] as { errorCode: string }).errorCode).toBe('EXECUTION_AGENT_ENFORCEMENT_FAILED');
    }
  });

  // L427: unclear clarification uses error.message when planning_unclear_clarification is undefined
  it('uses error.message as clarification when planning_unclear_clarification is undefined (L427)', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'trace_l427', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'planning',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;

    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: [], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValue(ok({ commentId: 'c1' }));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValue(ok({ droppedLabels: [] }));

    // Send unclear result WITHOUT planning_unclear_clarification but WITH error.message
    const payload = {
      taskId: task.id,
      status: 'failed' as const,
      result: { planning_outcome_label: 'unclear' as const },
      error: { code: 'PLANNING_AGENT_UNCLEAR', message: 'Error-based clarification text' },
    };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);

    // The addComment should have been called with the error message
    expect(lac.addComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Error-based clarification text' })
    );
  });

  // L475: execution already_completed without summary uses fallback
  it('uses fallback summary when execution already_completed has no summary (L475)', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'trace_l475', linearIssueId: 'INT-123', webhookSecret: 'test-webhook-secret', agentType: 'execution',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;

    const lac = getServices().linearAgentClient;
    vi.mocked(lac.validateIssue).mockReset();
    vi.mocked(lac.validateIssue).mockResolvedValueOnce(ok({ id: 'routed-uuid', identifier: 'INT-123', title: 'T', url: 'u', labels: ['code-task'], childCount: 0, parentId: null }));
    vi.mocked(lac.addComment).mockReset();
    vi.mocked(lac.addComment).mockResolvedValue(ok({ commentId: 'c1' }));
    vi.mocked(lac.updateIssueState).mockReset();
    vi.mocked(lac.updateIssueState).mockResolvedValue(ok(undefined));
    vi.mocked(lac.updateIssueMetadata).mockReset();
    vi.mocked(lac.updateIssueMetadata).mockResolvedValue(ok({ droppedLabels: [] }));

    // Send already_completed WITHOUT summary
    const payload = {
      taskId: task.id,
      status: 'completed' as const,
      result: { execution_outcome_label: 'already_completed' as const },
    };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);

    // The addComment should have been called with fallback text
    expect(lac.addComment).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Work already completed: No details provided' })
    );
  });

  // L992: prNumber extraction - falsy path (no match on /pull/ pattern)
  it('does not set prNumber when prUrl has no /pull/ pattern', async () => {
    const createResult = await codeTaskRepo.create({
      userId: 'user-123', prompt: 'a', sanitizedPrompt: 'a', systemPromptHash: 'default', workerType: 'auto', workerLocation: 'mac',
      repository: 'pbuchman/intexuraos', baseBranch: 'development', traceId: 'tx10', webhookSecret: 'test-webhook-secret',
    });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) throw new Error('Failed');
    const task = createResult.value;
    const payload = { taskId: task.id, status: 'completed' as const, result: { prUrl: 'https://github.com/pbuchman/intexuraos/issues/42', branch: 'feat/test' } };
    const { timestamp, signature } = generateWebhookSignature(payload, 'test-webhook-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/webhooks/task-complete', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    const g = await codeTaskRepo.findById(task.id);
    expect(g.ok).toBe(true);
    if (!g.ok) throw new Error('Failed');
    expect(g.value.prNumber).toBeUndefined();
  });
});

describe('POST /internal/turn-metrics - branch coverage', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;

  function generateOrchestratorSignature(body: object, secret: string): { timestamp: string; signature: string } {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const rawBody = JSON.stringify(body);
    const message = `${timestamp}.${rawBody}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
    return { timestamp, signature };
  }

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({ payload: { sub: 'test-user-id', email: 'test@example.com' }, protectedHeader: new Uint8Array() } as never);
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = 'test-orch-secret';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;
    const codeTaskRepo = createFirestoreCodeTaskRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
    const logLineRepo = createFirestoreLogLineRepository({ firestore: fakeFirestore as unknown as Firestore, logger });
    const actionsAgentClient = createActionsAgentClient({ baseUrl: 'http://actions-agent', internalAuthToken: 'test-token', logger });
    const linearAgentClient = createLinearAgentHttpClient({ baseUrl: 'http://linear-agent:8086', internalAuthToken: 'test-token', timeoutMs: 10000 }, logger);

    setServices({
      firestore: fakeFirestore as unknown as Firestore, logger, codeTaskRepo,
      logChunkRepo: createFirestoreLogChunkRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      logLineRepo,
      taskDispatcher: createTaskDispatcherService({ logger, workerHealthProbe: mockWorkerHealthProbe }),
      workerSettingsRepo: createWorkerSettingsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      whatsappNotifier: createWhatsAppNotifier({ whatsappPublisher: { publishSendMessage: async () => ok(undefined) } as unknown as WhatsAppSendPublisher }),
      actionsAgentClient, linearAgentClient,
      rateLimitService: { async checkLimits() { return ok(undefined); }, async recordTaskStart() { return; }, async recordTaskComplete() { return; } },
      linearIssueService: createLinearIssueService({ linearAgentClient, logger }),
      metricsClient: createNoOpMetricsClient(),
      statusMirrorService: createStatusMirrorService({ actionsAgentClient, logger }),
      processHeartbeat: createProcessHeartbeatUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      detectZombieTasks: createDetectZombieTasksUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      cleanupTaskLogs: createCleanupTaskLogsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      archiveStaleGroups: createArchiveStaleGroupsUseCase({ codeTaskRepository: codeTaskRepo, logger }),
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo: createFirestoreGitHubPREventsRepository({ logger }),
      gitHubPRSummaryRepo: {} as never,
      turnMetricsRepo: createFirestoreTurnMetricsRepository({ firestore: fakeFirestore as unknown as Firestore, logger }),
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: {} as never, webhookRules: {} as never, dispatchService: {} as never, toolCallingClient: undefined,
      eventDecisionRepo: {} as never, dispatchRetryRepo: {} as never, unifiedEvaluator: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
      taskEnqueueService: {} as never,
      mergeConflictDetector: { detectOnPush: vi.fn().mockResolvedValue(undefined), reconcile: vi.fn().mockResolvedValue({ processed: 0 }) },
      mergeQueueWatchRepo: { create: vi.fn(), findById: vi.fn(), findActiveByUserAndBranch: vi.fn(), findAllActive: vi.fn(), findByUserAndRepo: vi.fn(), update: vi.fn(), appendMergedPr: vi.fn() },
    } as {
      firestore: Firestore; logger: Logger; codeTaskRepo: CodeTaskRepository; logChunkRepo: LogChunkRepository; logLineRepo: LogLineRepository;
      taskDispatcher: TaskDispatcherService; workerSettingsRepo: WorkerSettingsRepository; actionsAgentClient: ActionsAgentClient;
      linearAgentClient: LinearAgentClient; whatsappNotifier: WhatsAppNotifier; rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService; statusMirrorService: StatusMirrorService; metricsClient: MetricsClient;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      archiveStaleGroups: import('../../domain/usecases/archiveStaleGroups.js').ArchiveStaleGroupsUseCase;
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
      toolCallingClient: import('@intexuraos/llm-contract').ToolCallingClient | undefined;
      eventDecisionRepo: import('../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository;
      dispatchRetryRepo: import('../../domain/repositories/dispatchRetryRepository.js').DispatchRetryRepository;
      unifiedEvaluator: import('../../domain/services/unifiedEvaluator.js').UnifiedEvaluator;
      automationLog: import('../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeConflictDetector: import('../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      mergeQueueWatchRepo: import('../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });
    app = await buildServer();
  });

  afterEach(() => { resetServices(); resetFirestore(); vi.clearAllMocks(); });

  it('returns 500 when turnMetricsRepo.store fails', async () => {
    vi.spyOn(getServices().turnMetricsRepo, 'store').mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR', message: 'fail' }));
    const payload = { taskId: 'task_123', attempt: 1, timestamp: new Date().toISOString() };
    const { timestamp, signature } = generateOrchestratorSignature(payload, 'test-orch-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/turn-metrics', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(500);
  });

  it('returns 200 when logLineRepo.storeBatch fails (non-fatal)', async () => {
    const services = getServices();
    const storeSpy = vi.spyOn(services.turnMetricsRepo, 'store').mockResolvedValue(ok(undefined));
    const lineSpy = vi.spyOn(services.logLineRepo, 'storeBatch').mockResolvedValue(err({ code: 'FIRESTORE_ERROR', message: 'fail' }));
    const payload = {
      taskId: 'task_123', attempt: 1, timestamp: new Date().toISOString(),
      cpuTimeSeconds: 10, cpuCores: 4, peakMemoryMB: 512, wallTimeSeconds: 15,
      apiWaitSeconds: 5, toolExecSeconds: 3, backgroundWaitSeconds: 1, overheadSeconds: 1,
      totalInputTokens: 1000, totalOutputTokens: 500, totalCacheReadTokens: 200,
      totalCacheCreationTokens: 100, apiCallCount: 5, cpuUtilizationPercent: 50, idlePercent: 10,
    };
    const { timestamp, signature } = generateOrchestratorSignature(payload, 'test-orch-secret');
    const response = await app.inject({ method: 'POST', url: '/internal/turn-metrics', headers: { 'x-internal-auth': 'test-internal-token', 'x-request-timestamp': timestamp, 'x-request-signature': signature }, payload });
    expect(response.statusCode).toBe(200);
    storeSpy.mockRestore();
    lineSpy.mockRestore();
  });
});
