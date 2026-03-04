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

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

import { buildServer } from '../../server.js';
import { parseLinearIdentifierFromUrl } from '../../routes/webhookRoutes.js';
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
import { fetchWithAuth } from '@intexuraos/internal-clients';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';

// Mock fetchWithAuth
vi.mock('@intexuraos/internal-clients', async () => ({
  fetchWithAuth: vi.fn(),
}));

describe('parseLinearIdentifierFromUrl', () => {
  it('extracts identifier from valid Linear URL', () => {
    expect(parseLinearIdentifierFromUrl('https://linear.app/intexuraos/issue/INT-200/subtask-title')).toBe('INT-200');
  });

  it('returns null for non-linear.app hostname', () => {
    expect(parseLinearIdentifierFromUrl('https://github.com/intexuraos/issue/INT-200')).toBeNull();
  });

  it('returns null for Linear URL without issue path', () => {
    expect(parseLinearIdentifierFromUrl('https://linear.app/intexuraos/settings')).toBeNull();
  });

  it('returns null for malformed non-URL input', () => {
    expect(parseLinearIdentifierFromUrl('not-a-url')).toBeNull();
  });

  it('extracts URL from markdown link wrapper', () => {
    expect(parseLinearIdentifierFromUrl('[Subtask](https://linear.app/intexuraos/issue/INT-300/title)')).toBe('INT-300');
  });
});

describe('POST /internal/webhooks/task-complete', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;
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

    const logLineRepo = createFirestoreLogLineRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    taskDispatcher = createTaskDispatcherService({ logger });
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
        url: 'https://linear.app/intexuraos/issue/INT-123',
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
          url: 'https://linear.app/intexuraos/issue/INT-999',
          parentId: 'linear-issue-uuid',
          labels: [],
          assigneeId: null,
          state: 'Backlog',
        },
        descendants: [],
      })
    );
    vi.spyOn(linearAgentClient, 'updateIssueMetadata').mockResolvedValue(ok(undefined));
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
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
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
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/intexuraos/issue/INT-123',
          labels: [],
          childCount: 2,
          parentId: null,
        })
      );
      fetchIssueTreeSpy.mockResolvedValue(
        ok({
          root: {
            id: 'original-uuid',
            identifier: 'INT-123',
            url: 'https://linear.app/intexuraos/issue/INT-123',
            parentId: null,
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          descendants: [
            {
              id: 'child-1-uuid',
              identifier: 'INT-200',
              url: 'https://linear.app/intexuraos/issue/INT-200',
              parentId: 'original-uuid',
              labels: ['code-task'],
              assigneeId: null,
              state: 'Todo',
            },
            {
              id: 'child-2-uuid',
              identifier: 'INT-201',
              url: 'https://linear.app/intexuraos/issue/INT-201',
              parentId: 'original-uuid',
              labels: ['code-task'],
              assigneeId: null,
              state: 'Todo',
            },
          ],
        })
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
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
          addLabels: ['planned'],
          removeLabels: ['unclear', 'code-task'],
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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/intexuraos/issue/INT-123',
          labels: [],
          childCount: 1,
          parentId: null,
        })
      );
      fetchIssueTreeSpy.mockResolvedValue(
        ok({
          root: {
            id: 'original-uuid',
            identifier: 'INT-123',
            url: 'https://linear.app/intexuraos/issue/INT-123',
            parentId: null,
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          descendants: [
            {
              id: 'child-uuid',
              identifier: 'INT-200',
              url: 'https://linear.app/intexuraos/issue/INT-200',
              parentId: 'original-uuid',
              labels: [],
              assigneeId: 'some-user',
              state: 'Backlog',
            },
          ],
        })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Subtask not delivered correctly',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/intexuraos/issue/INT-123',
          labels: [],
          childCount: 1,
          parentId: null,
        })
      );
      fetchIssueTreeSpy.mockResolvedValue(
        ok({
          root: {
            id: 'original-uuid',
            identifier: 'INT-123',
            url: 'https://linear.app/intexuraos/issue/INT-123',
            parentId: null,
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          descendants: [
            {
              id: 'grandchild-uuid',
              identifier: 'INT-300',
              url: 'https://linear.app/intexuraos/issue/INT-300',
              parentId: 'some-other-parent',
              labels: [],
              assigneeId: null,
              state: 'Backlog',
            },
          ],
        })
      );

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Planned with non-direct subtask',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/intexuraos/issue/INT-123',
          labels: [],
          childCount: 1,
          parentId: null,
        })
      );
      fetchIssueTreeSpy.mockResolvedValue(
        ok({
          root: {
            id: 'original-uuid',
            identifier: 'INT-123',
            url: 'https://linear.app/intexuraos/issue/INT-123',
            parentId: null,
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          descendants: [
            {
              id: 'child-uuid',
              identifier: 'INT-200',
              url: 'https://linear.app/intexuraos/issue/INT-200',
              parentId: 'original-uuid',
              labels: ['code-task'],
              assigneeId: null,
              state: 'Todo',
            },
          ],
        })
      );
      addCommentSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex but no PR',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy
        .mockResolvedValueOnce(
          ok({
            id: 'original-uuid',
            identifier: 'INT-123',
            title: 'Original issue',
            url: 'https://linear.app/intexuraos/issue/INT-123',
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
            url: 'https://linear.app/intexuraos/issue/INT-200',
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
            url: 'https://linear.app/intexuraos/issue/INT-201',
            labels: [],
            childCount: 0,
            parentId: 'original-uuid',
          })
        );
      fetchIssueTreeSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex plan with URL-based subtasks',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: 'https://linear.app/intexuraos/issue/INT-200/subtask-1,https://linear.app/intexuraos/issue/INT-201/subtask-2',
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

      // fetchIssueTree must NOT be called — URL-based path was used
      expect(fetchIssueTreeSpy).not.toHaveBeenCalled();

      // validateIssue called: 1 for original + 2 for subtasks = 3 total (single pass)
      expect(validateIssueSpy).toHaveBeenCalledTimes(3);

      // Both subtasks normalized to todo
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-1-uuid', state: 'todo' })
      );
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-2-uuid', state: 'todo' })
      );

      // Both subtasks normalized + stamped with code-task in single call
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-1-uuid', removeLabels: ['planned', 'unclear'], addLabels: ['code-task'] })
      );
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'child-2-uuid', removeLabels: ['planned', 'unclear'], addLabels: ['code-task'] })
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
          url: 'https://linear.app/intexuraos/issue/INT-123',
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
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
          planning_is_complex: '1' as const,
          planning_subtask_urls: 'not-a-url,https://linear.app/intexuraos/issue/INT-200/subtask-1',
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

    it('complex planned: falls back to fetchIssueTree when subtask URLs empty', async () => {
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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/intexuraos/issue/INT-123',
          labels: [],
          childCount: 0,
          parentId: null,
        })
      );
      fetchIssueTreeSpy.mockResolvedValue(
        ok({
          root: {
            id: 'original-uuid',
            identifier: 'INT-123',
            url: 'https://linear.app/intexuraos/issue/INT-123',
            parentId: null,
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          descendants: [],
        })
      );
      fetchIssueTreeSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex plan without URLs',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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

      // fetchIssueTree must be called — fallback path
      expect(fetchIssueTreeSpy).toHaveBeenCalledTimes(1);
      expect(fetchIssueTreeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'original-uuid' })
      );

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('planned');
    });

    it('complex planned: falls back to fetchIssueTree when URL extraction is partial', async () => {
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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      // Parent has 3 children but only 1 URL was extracted
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/intexuraos/issue/INT-123',
          labels: [],
          childCount: 3,
          parentId: null,
        })
      );
      fetchIssueTreeSpy.mockResolvedValue(
        ok({
          root: {
            id: 'original-uuid',
            identifier: 'INT-123',
            url: 'https://linear.app/intexuraos/issue/INT-123',
            parentId: null,
            labels: [],
            assigneeId: null,
            state: 'In Progress',
          },
          descendants: [
            {
              id: 'child-1-uuid',
              identifier: 'INT-200',
              url: 'https://linear.app/intexuraos/issue/INT-200',
              parentId: 'original-uuid',
              labels: [],
              assigneeId: null,
              state: 'In Progress',
            },
            {
              id: 'child-2-uuid',
              identifier: 'INT-201',
              url: 'https://linear.app/intexuraos/issue/INT-201',
              parentId: 'original-uuid',
              labels: [],
              assigneeId: null,
              state: 'In Progress',
            },
            {
              id: 'child-3-uuid',
              identifier: 'INT-202',
              url: 'https://linear.app/intexuraos/issue/INT-202',
              parentId: 'original-uuid',
              labels: [],
              assigneeId: null,
              state: 'In Progress',
            },
          ],
        })
      );
      fetchIssueTreeSpy.mockClear();
      updateIssueStateSpy.mockClear();
      updateIssueMetadataSpy.mockClear();

      const payload = {
        taskId: task.id,
        status: 'completed' as const,
        result: {
          summary: 'Complex plan with partial URL extraction',
          planning_outcome_label: 'planned' as const,
          planning_superpowers_writing_plans_used: '1' as const,
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
          planning_is_complex: '1' as const,
          // Only 1 of 3 subtask URLs extracted by LLM
          planning_subtask_urls: 'https://linear.app/intexuraos/issue/INT-200/subtask-1',
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

      // fetchIssueTree must be called — partial extraction triggers fallback
      expect(fetchIssueTreeSpy).toHaveBeenCalledTimes(1);
      expect(fetchIssueTreeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'original-uuid' })
      );

      // validateIssue called only once for original issue (no URL-based subtask resolution)
      expect(validateIssueSpy).toHaveBeenCalledTimes(1);

      // All 3 direct children normalized via tree fallback
      expect(updateIssueStateSpy).toHaveBeenCalledTimes(4); // 1 parent + 3 children
      expect(updateIssueMetadataSpy).toHaveBeenCalledTimes(4); // 1 parent + 3 children

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
      const fetchIssueTreeSpy = vi.mocked(linearAgentClient.fetchIssueTree);
      const addCommentSpy = vi.mocked(linearAgentClient.addComment);
      const updateIssueStateSpy = vi.mocked(linearAgentClient.updateIssueState);
      const updateIssueMetadataSpy = vi.mocked(linearAgentClient.updateIssueMetadata);

      validateIssueSpy.mockReset();
      validateIssueSpy.mockResolvedValueOnce(
        ok({
          id: 'original-uuid',
          identifier: 'INT-123',
          title: 'Original issue',
          url: 'https://linear.app/intexuraos/issue/INT-123',
          labels: [],
          childCount: 0,
          parentId: null,
        })
      );
      fetchIssueTreeSpy.mockClear();
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
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
      expect(fetchIssueTreeSpy).not.toHaveBeenCalled();

      // Should only validate the original issue (1 call)
      expect(validateIssueSpy).toHaveBeenCalledTimes(1);

      // Should move original issue to todo
      expect(updateIssueStateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ issueId: 'original-uuid', state: 'todo' })
      );

      // Simple: addLabels=[], removeLabels=['unclear', 'planned'], then stamp code-task
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'original-uuid',
          addLabels: [],
          removeLabels: ['unclear', 'planned'],
        })
      );
      // Stamp code-task label as last step (removes unclear, clears assignee)
      expect(updateIssueMetadataSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          issueId: 'original-uuid',
          assigneeId: null,
          addLabels: ['code-task'],
          removeLabels: ['unclear'],
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
          url: 'https://linear.app/intexuraos/issue/INT-123',
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
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
          url: 'https://linear.app/intexuraos/issue/INT-123',
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
          planning_linear_url: 'https://linear.app/intexuraos/issue/INT-123',
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
            url: 'https://linear.app/intexuraos/issue/INT-123',
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
            url: 'https://linear.app/intexuraos/issue/INT-123',
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
          execution_superpowers_executing_plans_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/intexuraos/issue/INT-123',
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
        expect.objectContaining({ issueId: 'routed-uuid', assigneeId: null, addLabels: ['code-task'], removeLabels: ['unclear'] })
      );
      expect(markInReviewSpy).not.toHaveBeenCalled();

      const getResult = await codeTaskRepo.findById(task.id);
      expect(getResult.ok).toBe(true);
      if (!getResult.ok) throw new Error('Failed to get task');
      expect(getResult.value.status).toBe('implemented');
      expect(getResult.value.result?.execution_outcome_label).toBe('implemented');
      expect(getResult.value.result?.execution_linear_issue_url).toContain('/INT-123');
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
          url: 'https://linear.app/intexuraos/issue/INT-123',
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
          execution_superpowers_executing_plans_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: '[INT-123](https://linear.app/intexuraos/issue/INT-123)',
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
            url: 'https://linear.app/intexuraos/issue/INT-123',
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
            url: 'https://linear.app/intexuraos/issue/INT-999',
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
          execution_superpowers_executing_plans_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/intexuraos/issue/INT-999',
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
          execution_superpowers_executing_plans_used: '1' as const,
          execution_superpowers_requesting_code_review_used: '1' as const,
          execution_linear_issue_url: 'https://linear.app/intexuraos/issue/INT-123',
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
          url: 'https://linear.app/intexuraos/issue/INT-456',
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
        actionId: 'action-123',
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
        `/internal/actions/action-123/status`,
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
        actionId: 'action-pr-less',
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
        `/internal/actions/action-pr-less/status`,
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
        actionId: 'action-789',
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
        `/internal/actions/action-789/status`,
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
        actionId: 'action-update-fail',
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
        actionId: 'action-456',
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

      // Verify actions-agent was called with 'failed' status
      expect(mockFetchWithAuth).toHaveBeenCalledWith(
        expect.any(Object),
        '/internal/actions/action-456/status',
        expect.objectContaining({
          body: JSON.stringify({
            resource_status: 'failed',
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
        actionId: 'action-789',
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
      taskDispatcher: createTaskDispatcherService({ logger }),
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
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
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

    taskDispatcher = createTaskDispatcherService({ logger });
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
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
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

    taskDispatcher = createTaskDispatcherService({ logger });
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
      workerHealthProbe: WorkerHealthProbe;
      gitHubPREventRepo: import('../../domain/repositories/gitHubPREventRepository.js').GitHubPREventRepository;
      gitHubPRSummaryRepo: import('../../domain/repositories/gitHubPRSummaryRepository.js').GitHubPRSummaryRepository;
      turnMetricsRepo: import('../../domain/repositories/turnMetricsRepository.js').TurnMetricsRepository;
      userServiceClient: import('@intexuraos/internal-clients').UserServiceClient;
      gitHubPRClient: import('../../domain/ports/gitHubPRClient.js').GitHubPRClient;
      webhookRules: import('../../domain/services/gitHubWebhookRules.js').WebhookRulesService;
      dispatchService: import('../../domain/services/gitHubDispatchService.js').WebhookDispatchService;
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
    expect(params?.message).toContain('completed');
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
    const params = publishCall?.[0] as { userId: string; message: string } | undefined;
    expect(params?.userId).toBe('user-123');
    expect(params?.message).toContain('completed');
    expect(params?.message).toContain('fix/login-bug');
    expect(params?.message).toContain('https://github.com/pbuchman/intexuraos/pull/123');
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
    expect(params?.message).toContain('failed');
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
    expect(params?.message).toContain('failed');
    expect(params?.message).toContain('interrupted');
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
    expect(params.message).toContain('Session continued');
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
});
