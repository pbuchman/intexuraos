/**
 * Tests for POST /code/submit endpoint
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
import { getServices, resetServices, setServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createFirestoreLogLineRepository } from '../../infra/repositories/firestoreLogLineRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { LogLineRepository } from '../../domain/repositories/logLineRepository.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createFirestoreGitHubPREventsRepository } from '../../infra/firestore/gitHubPREventsRepository.js';
import { createFirestoreTurnMetricsRepository } from '../../infra/repositories/firestoreTurnMetricsRepository.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';
import { createCleanupTaskLogsUseCase } from '../../domain/usecases/cleanupTaskLogs.js';
import { createNoOpMetricsClient, type MetricsClient } from '../../infra/metrics.js';
import { createWorkerSettingsRepository } from '../../infra/firestore/workerSettingsRepository.js';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { WorkerHealthProbe } from '../../domain/ports/workerHealthProbe.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../helpers/mockServices.js';

describe('POST /code/submit', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let logChunkRepo: LogChunkRepository;

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

    taskDispatcher = createTaskDispatcherService({
      logger,
      workerHealthProbe: mockWorkerHealthProbe,
    });

    const whatsappNotifier = createWhatsAppNotifier({
      whatsappPublisher: {
        publishSendMessage: async () => ok(undefined),
      } as unknown as WhatsAppSendPublisher,
    });

    logChunkRepo = createFirestoreLogChunkRepository({
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
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
      cleanupTaskLogs: import('../../domain/usecases/cleanupTaskLogs.js').CleanupTaskLogsUseCase;
      workerSettingsRepo: WorkerSettingsRepository;
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
    });

    // Set up worker settings for the test user
    const services = getServices();
    await services.workerSettingsRepo.addWorker('test-user-id', {
      name: 'home-mac',
      url: 'https://cc-mac.intexuraos.cloud',
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  describe('authentication', () => {
    it('returns 401 without Authorization header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        payload: {
          prompt: 'Fix the bug',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
    });

    it('returns 401 with invalid token', async () => {
      // Make jwtVerify reject to simulate invalid token
      mockedJwtVerify.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer invalid-token',
        },
        payload: {
          prompt: 'Fix the bug',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('successful task submission', () => {
    it('creates task with valid request and defaults workerType to auto', async () => {
      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the login bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      // Mock taskDispatcher to succeed
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('submitted');
      expect(body.data.codeTaskId).toBeDefined();

      // Verify dispatch was called with default workerType
      expect(taskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          workerType: 'auto',
        })
      );
    });

    it('sets agentType to execution when issue has code-task label', async () => {
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-999',
        linearIssueTitle: 'Execution ready feature',
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: { dispatched: true, workerLocation: 'home-dev' },
      });
      const createSpy = vi.spyOn(codeTaskRepo, 'create');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Build execution feature' },
      });

      expect(response.statusCode).toBe(200);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'execution',
          linearIssueId: 'INT-999',
        })
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearIssueTitle: expect.anything(),
        })
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearIssueLabels: expect.anything(),
        })
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.not.objectContaining({
          linearFallback: expect.anything(),
        })
      );
    });

    it('uses provided workerType when specified', async () => {
      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-124',
        linearIssueTitle: 'Fix the login bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
          workerType: 'opus',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the worker type was passed through
      expect(taskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          workerType: 'opus',
        })
      );
    });

    it('includes linearIssueId when provided', async () => {
      // Mock linearIssueService.ensureIssueExists to return the provided issue ID
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-305',
        linearIssueTitle: 'Fix the login bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the login bug',
          linearIssueId: 'INT-305',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the linear issue ID was passed through
      expect(taskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          linearIssueId: 'INT-305',
        })
      );

      // Verify markInProgress was called with correct userId
      expect(linearService.markInProgress).toHaveBeenCalledWith('test-user-id', 'INT-305');
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when hourly limit exceeded', async () => {
      // Get the service container and mock rateLimitService to return error
      const { getServices } = await import('../../services.js');
      const services = getServices();

      // Mock rateLimitService to return hourly limit error
      vi.spyOn(services.rateLimitService, 'checkLimits').mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'hourly_limit',
          message: 'Maximum 10 tasks per hour allowed',
          retryAfter: 'in about 1 hour',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'This should exceed the limit',
        },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.message).toContain('tasks per hour');
    });

    it('returns 429 when concurrent limit exceeded', async () => {
      const { getServices } = await import('../../services.js');
      const services = getServices();

      vi.spyOn(services.rateLimitService, 'checkLimits').mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'concurrent_limit',
          message: 'Maximum 3 concurrent tasks allowed',
          retryAfter: 'when a task completes',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Test prompt' },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.message).toContain('concurrent tasks');
    });

    it('returns 429 when monthly cost limit exceeded', async () => {
      const { getServices } = await import('../../services.js');
      const services = getServices();

      vi.spyOn(services.rateLimitService, 'checkLimits').mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'monthly_cost_limit',
          message: 'Monthly cost limit of $200 reached',
          retryAfter: 'next month',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Test prompt' },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.message).toContain('cost limit');
    });

    it('returns 429 when prompt too long', async () => {
      const { getServices } = await import('../../services.js');
      const services = getServices();

      vi.spyOn(services.rateLimitService, 'checkLimits').mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'prompt_too_long',
          message: 'Prompt exceeds maximum length of 10000 characters',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Test prompt' },
      });

      expect(response.statusCode).toBe(429);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(body.error.message).toContain('maximum length');
    });

    it('returns 503 when service unavailable', async () => {
      const { getServices } = await import('../../services.js');
      const services = getServices();

      vi.spyOn(services.rateLimitService, 'checkLimits').mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'service_unavailable',
          message: 'Unable to verify rate limits. Please try again.',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Test prompt' },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('MISCONFIGURED');
      expect(body.error.message).toContain('rate limits');
    });

    it('allows submissions when within limits', async () => {
      // Mock Linear issue service (required for submit flow)
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'This should be allowed',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValueOnce(undefined);

      // Mock successful dispatch
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'This should be allowed',
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('does not create Linear issue when rate limit exceeded', async () => {
      const { getServices } = await import('../../services.js');
      const services = getServices();

      vi.spyOn(services.rateLimitService, 'checkLimits').mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'concurrent_limit',
          message: 'Maximum 3 concurrent tasks allowed',
        },
      });

      const linearSpy = vi.spyOn(services.linearIssueService, 'ensureIssueExists');

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Test prompt', linearIssueId: 'INT-123' },
      });

      expect(response.statusCode).toBe(429);
      expect(linearSpy).not.toHaveBeenCalled();
    });

    it('calls recordTaskStart when task is submitted successfully', async () => {
      const { getServices } = await import('../../services.js');
      const services = getServices();

      // Mock Linear issue service (required for submit flow)
      vi.spyOn(services.linearIssueService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-456',
        linearIssueTitle: 'Test prompt',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(services.linearIssueService, 'markInProgress').mockResolvedValueOnce(undefined);

      const recordStartSpy = vi.spyOn(services.rateLimitService, 'recordTaskStart');

      // Mock successful dispatch
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: { authorization: 'Bearer test-token' },
        payload: { prompt: 'Test prompt' },
      });

      expect(response.statusCode).toBe(200);
      expect(recordStartSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('prompt deduplication', () => {
    it('returns 409 for duplicate prompt within 5 minutes', async () => {
      const prompt = 'Fix the login bug';

      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: prompt,
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValue(undefined);

      // Mock successful dispatch
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValue({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      } as const);

      // Submit first task
      const response1 = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt,
        },
      });

      expect(response1.statusCode).toBe(200);

      // Try to submit duplicate immediately
      const response2 = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt,
        },
      });

      expect(response2.statusCode).toBe(409);
      const body = JSON.parse(response2.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });

    it('returns 409 when active task exists for Linear issue', async () => {
      // Mock successful dispatch for first request
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      const linearIssueId = 'INT-305';

      // Mock linearIssueService.ensureIssueExists
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValue({
        linearIssueId,
        linearIssueTitle: 'First task',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValue(undefined);

      // Create first task with this Linear issue via direct repository call
      await codeTaskRepo.create({
        userId: 'test-user-id',
        prompt: 'First task',
        sanitizedPrompt: 'First task',
        systemPromptHash: 'default',
        workerType: 'auto',
        workerLocation: 'mac',
        repository: 'pbuchman/intexuraos',
        baseBranch: 'development',
        traceId: 'trace_1',
        linearIssueId,
      });

      // Try to create second task with same Linear issue (should fail)
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Second task',
          linearIssueId,
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('CONFLICT');
    });
  });

  describe('error handling', () => {
    it('returns 503 when worker dispatch fails', async () => {
      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the bug',
        linearIssueLabels: [],
        hasChildren: false,
        linearFallback: false,
      });
      vi.spyOn(linearService, 'markInProgress').mockResolvedValue(undefined);

      // Mock fetch to return 503 (worker busy/unavailable)
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });
      global.fetch = mockFetch as unknown as typeof fetch;

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: 'Fix the bug',
        },
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        success: false,
        error: {
          code: 'MISCONFIGURED',
          message: 'Failed to dispatch task to worker',
        },
      });
    });
  });

  describe('input validation', () => {
    it('rejects requests without prompt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          // Missing prompt
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects empty prompt', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: '',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts valid worker types', async () => {
      const workerTypes = ['opus', 'auto', 'sonnet', 'minimax', 'glm', 'qwen', 'kimi'] as const;

      // Mock successful dispatch for all iterations
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValue({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      } as const);

      for (const workerType of workerTypes) {
        const response = await app.inject({
          method: 'POST',
          url: '/code/submit',
          headers: {
            authorization: 'Bearer test-token',
          },
          payload: {
            prompt: `Fix the bug with ${workerType}`,
            workerType,
          },
        });

        expect(response.statusCode).toBe(200);
      }
    });
  });

  describe('prompt sanitization', () => {
    it('trims and collapses spaces in prompt', async () => {
      // Mock successful dispatch
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/code/submit',
        headers: {
          authorization: 'Bearer test-token',
        },
        payload: {
          prompt: '  Fix    the   bug  ',  // Extra spaces
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify the prompt was sanitized in the dispatched request
      expect(taskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Fix the bug',  // Sanitized
        })
      );
    });
  });
});
