/**
 * Tests for JWT-authenticated merge queue routes:
 *   POST   /code/merge-queue/watch
 *   DELETE /code/merge-queue/watch/:watchId
 *   GET    /code/merge-queue/watches
 *   GET    /code/merge-queue/branches
 *   GET    /code/merge-queue/prs
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
import { getServices, resetServices, setServices } from '../../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from 'pino';
import { ok, err } from '@intexuraos/common-core';
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
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreGitHubPRSummariesRepository } from '../../../infra/firestore/gitHubPRSummariesRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../../infra/repositories/firestoreTurnMetricsRepository.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../../helpers/mockServices.js';
import type { MergeQueueWatchRepository } from '../../../domain/repositories/mergeQueueWatchRepository.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';

describe('Merge queue JWT routes', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let mockMergeQueueWatchRepo: MergeQueueWatchRepository;
  let mockGitHubPRClient: GitHubPRClient;

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

    mockMergeQueueWatchRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findActiveByUserAndBranch: vi.fn(),
      findAllActive: vi.fn().mockResolvedValue(ok([])),
      findByUserAndRepo: vi.fn(),
      update: vi.fn(),
      appendMergedPr: vi.fn(),
    };

    mockGitHubPRClient = {
      updatePRTitle: vi.fn(),
      getPullRequestFiles: vi.fn(),
      getPullRequestCommits: vi.fn(),
      getPullRequestBaseBranch: vi.fn(),
      getPullRequestStatus: vi.fn(),
      postPRComment: vi.fn(),
      listOpenPullRequestsByBaseBranch: vi.fn(),
      getPullRequestDetails: vi.fn(),
      getIssueComment: vi.fn(),
      updateIssueComment: vi.fn(),
      mergePullRequest: vi.fn(),
      getCombinedCheckStatus: vi.fn(),
      listAllOpenPullRequests: vi.fn(),
    };

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
      userServiceClient: {
        ...mockUserServiceClient,
        async getOAuthToken() {
          return ok({ accessToken: 'gh-test-token', expiresAt: null });
        },
      },
      gitHubPRClient: mockGitHubPRClient,
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
        reconcile: vi.fn().mockResolvedValue({ processed: 0 }),
      },
      mergeQueueWatchRepo: mockMergeQueueWatchRepo,
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
      mergeConflictDetector: import('../../../domain/services/mergeConflictDetector.js').MergeConflictDetector;
      automationLog: import('../../../domain/ports/automationLog.js').AutomationLog;
      taskEnqueueService: import('../../../domain/services/taskEnqueueService.js').TaskEnqueueService;
      mergeQueueWatchRepo: import('../../../domain/repositories/mergeQueueWatchRepository.js').MergeQueueWatchRepository;
    });

    server = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  // ─── POST /code/merge-queue/watch ─────────────────────────────────────────

  describe('POST /code/merge-queue/watch', () => {
    it('should return 401 without JWT', async () => {
      mockedJwtVerify.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer bad-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should create watch successfully', async () => {
      // Mock GitHub user resolution
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      // Mock repository access check (push access)
      nock('https://api.github.com')
        .get('/repos/intexuraos/repo')
        .reply(200, { permissions: { push: true } });

      const watchDoc = {
        id: 'watch-123',
        userId: 'test-user-id',
        gitHubUsername: 'testuser',
        owner: 'intexuraos',
        repo: 'repo',
        baseBranch: 'main',
        status: 'active' as const,
        mergedPrs: [],
        skippedPrs: [],
        lastError: null,
        lastErrorAt: null,
        createdAt: { toDate: (): Date => new Date() },
        lastTickAt: null,
        drainedAt: null,
        cancelledAt: null,
      };

      vi.mocked(mockMergeQueueWatchRepo.create).mockResolvedValue(ok(watchDoc as never));

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { id: string } };
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('watch-123');
    });

    it('should return error when body fields are missing', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('owner, repo, and baseBranch are required');
    });

    it('should return 409 on duplicate watch', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      nock('https://api.github.com')
        .get('/repos/intexuraos/repo')
        .reply(200, { permissions: { push: true } });

      vi.mocked(mockMergeQueueWatchRepo.create).mockResolvedValue(
        err({ code: 'CONFLICT' as const, message: 'Watch already exists' })
      );

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
      expect(body.error.message).toBe('Watch already exists');
    });

    it('should return error when GitHub username resolution fails', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(401, { message: 'Bad credentials' });

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Failed to resolve GitHub username');
    });

    it('should return error when OAuth token resolution fails', async () => {
      // Override the default mock to return an error
      const services = getServices();
      setServices({
        ...services,
        userServiceClient: {
          ...services.userServiceClient,
          async getOAuthToken() {
            return err({ code: 'CONNECTION_NOT_FOUND' as const, message: 'No OAuth connection' });
          },
        },
      } as never);

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Failed to resolve GitHub token');
    });

    it('should return error when repo access check fetch fails', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      nock('https://api.github.com')
        .get('/repos/intexuraos/repo')
        .reply(500, { message: 'Internal Server Error' });

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Failed to verify repository access');
    });

    it('should return error when create fails with non-CONFLICT error', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      nock('https://api.github.com')
        .get('/repos/intexuraos/repo')
        .reply(200, { permissions: { push: true } });

      vi.mocked(mockMergeQueueWatchRepo.create).mockResolvedValue(
        err({ code: 'INTERNAL' as never, message: 'Firestore write failed' })
      );

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Firestore write failed');
    });

    it('should return error when GitHub username is null (login field missing)', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, {});

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Failed to resolve GitHub username');
    });

    it('should return error when user lacks push access', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      nock('https://api.github.com')
        .get('/repos/intexuraos/repo')
        .reply(200, { permissions: { push: false } });

      const response = await server.inject({
        method: 'POST',
        url: '/code/merge-queue/watch',
        headers: { authorization: 'Bearer fake-token' },
        payload: { owner: 'intexuraos', repo: 'repo', baseBranch: 'main' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
      expect(body.error.message).toBe('You do not have push access to this repository');
    });
  });

  // ─── DELETE /code/merge-queue/watch/:watchId ──────────────────────────────

  describe('DELETE /code/merge-queue/watch/:watchId', () => {
    it('should cancel watch successfully', async () => {
      vi.mocked(mockMergeQueueWatchRepo.findById).mockResolvedValue(
        ok({
          id: 'watch-123',
          userId: 'test-user-id',
          gitHubUsername: 'testuser',
          owner: 'intexuraos',
          repo: 'repo',
          baseBranch: 'main',
          status: 'active' as const,
          mergedPrs: [],
          skippedPrs: [],
          lastError: null,
          lastErrorAt: null,
          createdAt: { toDate: () => new Date() },
          lastTickAt: null,
          drainedAt: null,
          cancelledAt: null,
        } as never)
      );

      vi.mocked(mockMergeQueueWatchRepo.update).mockResolvedValue(ok(undefined));

      const response = await server.inject({
        method: 'DELETE',
        url: '/code/merge-queue/watch/watch-123',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { success: boolean } };
      expect(body.success).toBe(true);
      expect(body.data.success).toBe(true);

      expect(mockMergeQueueWatchRepo.update).toHaveBeenCalledWith('watch-123', expect.objectContaining({
        status: 'cancelled',
      }));
    });

    it('should return error for non-existent watch', async () => {
      vi.mocked(mockMergeQueueWatchRepo.findById).mockResolvedValue(
        err({ code: 'NOT_FOUND' as const, message: 'Watch not found' })
      );

      const response = await server.inject({
        method: 'DELETE',
        url: '/code/merge-queue/watch/nonexistent',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('Watch not found');
    });

    it('should return 500 when findById returns a non-NOT_FOUND error', async () => {
      vi.mocked(mockMergeQueueWatchRepo.findById).mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Connection lost' })
      );

      const response = await server.inject({
        method: 'DELETE',
        url: '/code/merge-queue/watch/watch-broken',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Connection lost');
    });

    it('should return error when update fails', async () => {
      vi.mocked(mockMergeQueueWatchRepo.findById).mockResolvedValue(
        ok({
          id: 'watch-123',
          userId: 'test-user-id',
          gitHubUsername: 'testuser',
          owner: 'intexuraos',
          repo: 'repo',
          baseBranch: 'main',
          status: 'active' as const,
          mergedPrs: [],
          skippedPrs: [],
          lastError: null,
          lastErrorAt: null,
          createdAt: { toDate: () => new Date() },
          lastTickAt: null,
          drainedAt: null,
          cancelledAt: null,
        } as never)
      );

      vi.mocked(mockMergeQueueWatchRepo.update).mockResolvedValue(
        err({ code: 'INTERNAL' as never, message: 'Firestore update failed' })
      );

      const response = await server.inject({
        method: 'DELETE',
        url: '/code/merge-queue/watch/watch-123',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Firestore update failed');
    });

    it('should return error when user does not own the watch', async () => {
      vi.mocked(mockMergeQueueWatchRepo.findById).mockResolvedValue(
        ok({
          id: 'watch-456',
          userId: 'other-user-id',
          gitHubUsername: 'otheruser',
          owner: 'intexuraos',
          repo: 'repo',
          baseBranch: 'main',
          status: 'active' as const,
          mergedPrs: [],
          skippedPrs: [],
          lastError: null,
          lastErrorAt: null,
          createdAt: { toDate: () => new Date() },
          lastTickAt: null,
          drainedAt: null,
          cancelledAt: null,
        } as never)
      );

      const response = await server.inject({
        method: 'DELETE',
        url: '/code/merge-queue/watch/watch-456',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Not authorized to cancel this watch');
    });
  });

  // ─── GET /code/merge-queue/watches ────────────────────────────────────────

  describe('GET /code/merge-queue/watches', () => {
    it('should return watches for user and repo', async () => {
      const watches = [
        {
          id: 'watch-1',
          userId: 'test-user-id',
          gitHubUsername: 'testuser',
          owner: 'intexuraos',
          repo: 'repo',
          baseBranch: 'main',
          status: 'active' as const,
          mergedPrs: [],
          skippedPrs: [],
          lastError: null,
          lastErrorAt: null,
          createdAt: { toDate: (): Date => new Date() },
          lastTickAt: null,
          drainedAt: null,
          cancelledAt: null,
        },
      ];

      vi.mocked(mockMergeQueueWatchRepo.findByUserAndRepo).mockResolvedValue(ok(watches as never));

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/watches?owner=intexuraos&repo=repo',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { watches: unknown[] } };
      expect(body.success).toBe(true);
      expect(body.data.watches).toHaveLength(1);
    });

    it('should return error when owner or repo query params are missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/watches',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('owner and repo query parameters are required');
    });

    it('should return error when findByUserAndRepo fails', async () => {
      vi.mocked(mockMergeQueueWatchRepo.findByUserAndRepo).mockResolvedValue(
        err({ code: 'INTERNAL' as never, message: 'Firestore read failed' })
      );

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/watches?owner=intexuraos&repo=repo',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Firestore read failed');
    });
  });

  // ─── GET /code/merge-queue/branches ───────────────────────────────────────

  describe('GET /code/merge-queue/branches', () => {
    it('should return branches with open PR counts from Firestore', async () => {
      // Seed Firestore with open PR summaries
      const { gitHubPRSummaryRepo } = getServices();
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 1, title: 'PR 1',
        state: 'open', baseBranch: 'main', authorLogin: 'user1', headBranch: 'feat-1',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 2, title: 'PR 2',
        state: 'open', baseBranch: 'main', authorLogin: 'user2', headBranch: 'feat-2',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 3, title: 'PR 3',
        state: 'open', baseBranch: 'develop', authorLogin: 'user1', headBranch: 'feat-3',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/branches?owner=intexuraos&repo=repo',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { branches: { name: string; openPrCount: number }[] } };
      expect(body.success).toBe(true);

      const branches = body.data.branches;
      const mainBranch = branches.find((b) => b.name === 'main');
      const developBranch = branches.find((b) => b.name === 'develop');
      expect(mainBranch?.openPrCount).toBe(2);
      expect(developBranch?.openPrCount).toBe(1);
    });

    it('should not include PRs from other repositories', async () => {
      const { gitHubPRSummaryRepo } = getServices();
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 1, title: 'PR 1',
        state: 'open', baseBranch: 'main', authorLogin: 'user1', headBranch: 'feat-1',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });
      await gitHubPRSummaryRepo.upsert({
        repository: 'other-org/other-repo', pullRequestNumber: 2, title: 'PR 2',
        state: 'open', baseBranch: 'main', authorLogin: 'user2', headBranch: 'feat-2',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/branches?owner=intexuraos&repo=repo',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { success: boolean; data: { branches: { name: string; openPrCount: number }[] } };
      expect(body.data.branches).toHaveLength(1);
      expect(body.data.branches[0]?.openPrCount).toBe(1);
    });

    it('should return error when owner or repo query params are missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/branches?owner=intexuraos',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
    });
  });

  // ─── GET /code/merge-queue/prs ────────────────────────────────────────────

  describe('GET /code/merge-queue/prs', () => {
    it('should return PRs from Firestore with merge conflict status', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      vi.mocked(mockMergeQueueWatchRepo.findActiveByUserAndBranch).mockResolvedValue(ok(null));

      // Seed Firestore with an open PR summary
      const { gitHubPRSummaryRepo } = getServices();
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 10, title: 'Feature PR',
        state: 'open', baseBranch: 'main', authorLogin: 'testuser', headBranch: 'feat-10',
        mergeConflictStatus: 'clean', lastConflictCheckedAt: new Date(),
        lastActivityAt: new Date('2024-01-01T00:00:00Z'), firstSeenAt: new Date('2024-01-01T00:00:00Z'),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/prs?owner=intexuraos&repo=repo&baseBranch=main',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { pullRequests: { number: number; title: string; mergeConflictStatus: string | null; authorIsEligible: boolean }[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.pullRequests).toHaveLength(1);

      const pr = body.data.pullRequests[0];
      expect(pr?.number).toBe(10);
      expect(pr?.title).toBe('Feature PR');
      expect(pr?.mergeConflictStatus).toBe('clean');
      expect(pr?.authorIsEligible).toBe(true);
    });

    it('should return error when required query params are missing', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/prs?owner=intexuraos&repo=repo',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INVALID_REQUEST');
      expect(body.error.message).toBe('owner, repo, and baseBranch query parameters are required');
    });

    it('should return error when OAuth token resolution fails', async () => {
      const services = getServices();
      setServices({
        ...services,
        userServiceClient: {
          ...services.userServiceClient,
          async getOAuthToken() {
            return err({ code: 'CONNECTION_NOT_FOUND' as const, message: 'No OAuth connection' });
          },
        },
      } as never);

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/prs?owner=intexuraos&repo=repo&baseBranch=main',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body) as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toBe('Failed to resolve GitHub token');
    });

    it('should use watch gitHubUsername for eligibility when active watch exists', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      vi.mocked(mockMergeQueueWatchRepo.findActiveByUserAndBranch).mockResolvedValue(ok({
        id: 'watch-1',
        userId: 'test-user-id',
        gitHubUsername: 'watch-owner',
        owner: 'intexuraos',
        repo: 'repo',
        baseBranch: 'main',
        status: 'active' as const,
        mergedPrs: [],
        skippedPrs: [],
        lastError: null,
        lastErrorAt: null,
        createdAt: { toDate: () => new Date() },
        lastTickAt: null,
        drainedAt: null,
        cancelledAt: null,
      } as never));

      const { gitHubPRSummaryRepo } = getServices();
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 10, title: 'PR',
        state: 'open', baseBranch: 'main', authorLogin: 'watch-owner', headBranch: 'feat',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 11, title: 'PR2',
        state: 'open', baseBranch: 'main', authorLogin: 'testuser', headBranch: 'feat2',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/prs?owner=intexuraos&repo=repo&baseBranch=main',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { pullRequests: { number: number; authorIsEligible: boolean }[] };
      };
      // watch-owner's PR should be eligible
      const watchOwnerPr = body.data.pullRequests.find((pr) => pr.number === 10);
      expect(watchOwnerPr?.authorIsEligible).toBe(true);
      // testuser's PR should NOT be eligible (watch overrides to watch-owner)
      const testUserPr = body.data.pullRequests.find((pr) => pr.number === 11);
      expect(testUserPr?.authorIsEligible).toBe(false);
    });

    it('should handle findActiveByUserAndBranch error gracefully', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      vi.mocked(mockMergeQueueWatchRepo.findActiveByUserAndBranch).mockResolvedValue(
        err({ code: 'INTERNAL' as never, message: 'Firestore error' })
      );

      const { gitHubPRSummaryRepo } = getServices();
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 10, title: 'PR',
        state: 'open', baseBranch: 'main', authorLogin: 'testuser', headBranch: 'feat',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/prs?owner=intexuraos&repo=repo&baseBranch=main',
        headers: { authorization: 'Bearer fake-token' },
      });

      // Should still succeed, just using gitHubUsername fallback
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { pullRequests: { number: number; authorIsEligible: boolean }[] };
      };
      expect(body.data.pullRequests[0]?.authorIsEligible).toBe(true);
    });

    it('should mark bot PRs as eligible', async () => {
      nock('https://api.github.com')
        .get('/user')
        .reply(200, { login: 'testuser' });

      vi.mocked(mockMergeQueueWatchRepo.findActiveByUserAndBranch).mockResolvedValue(ok(null));

      const { gitHubPRSummaryRepo } = getServices();
      await gitHubPRSummaryRepo.upsert({
        repository: 'intexuraos/repo', pullRequestNumber: 20, title: 'Bot PR',
        state: 'open', baseBranch: 'main', authorLogin: 'claude[bot]', headBranch: 'bot-branch',
        lastActivityAt: new Date(), firstSeenAt: new Date(),
      });

      const response = await server.inject({
        method: 'GET',
        url: '/code/merge-queue/prs?owner=intexuraos&repo=repo&baseBranch=main',
        headers: { authorization: 'Bearer fake-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        success: boolean;
        data: { pullRequests: { number: number; authorIsEligible: boolean }[] };
      };
      expect(body.data.pullRequests[0]?.authorIsEligible).toBe(true);
    });
  });
});
