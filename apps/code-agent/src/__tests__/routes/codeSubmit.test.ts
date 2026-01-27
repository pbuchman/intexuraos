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
import { createWorkerDiscoveryService } from '../../infra/services/workerDiscoveryImpl.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { WorkerDiscoveryService } from '../../domain/services/workerDiscovery.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import type { WhatsAppSendPublisher } from '@intexuraos/infra-pubsub';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import { createProcessHeartbeatUseCase } from '../../domain/usecases/processHeartbeat.js';
import { createDetectZombieTasksUseCase } from '../../domain/usecases/detectZombieTasks.js';describe('POST /code/submit', () => {
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
    process.env['INTEXURAOS_CODE_WORKERS'] =
      'mac:https://cc-mac.intexuraos.cloud:1,vm:https://cc-vm.intexuraos.cloud:2';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_ID'] = 'test-client-id';
    process.env['INTEXURAOS_CF_ACCESS_CLIENT_SECRET'] = 'test-client-secret';
    process.env['INTEXURAOS_DISPATCH_SECRET'] = 'test-dispatch-secret';
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH0_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH0_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH0_JWKS_URI'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = pino({ name: 'test' }) as unknown as Logger;

    codeTaskRepo = createFirestoreCodeTaskRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });

    const workerDiscovery = createWorkerDiscoveryService({ logger });
    taskDispatcher = createTaskDispatcherService({
      logger,
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
      orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
      orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
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
      workerDiscovery,
      taskDispatcher,
      whatsappNotifier,
      logChunkRepo,
      actionsAgentClient,
      rateLimitService,
      linearIssueService,
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
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
      processHeartbeat: import('../../domain/usecases/processHeartbeat.js').ProcessHeartbeatUseCase;
      detectZombieTasks: import('../../domain/usecases/detectZombieTasks.js').DetectZombieTasksUseCase;
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
      expect(body.status).toBe('submitted');
      expect(body.codeTaskId).toBeDefined();

      // Verify dispatch was called with default workerType
      expect(taskDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          workerType: 'auto',
        })
      );
    });

    it('uses provided workerType when specified', async () => {
      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValueOnce({
        linearIssueId: 'INT-124',
        linearIssueTitle: 'Fix the login bug',
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
      expect(body.error.code).toBe('hourly_limit');
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
      expect(body.error.code).toBe('concurrent_limit');
      expect(body.error.retryAfter).toBe('when a task completes');
    });

    it('returns 429 when daily cost limit exceeded', async () => {
      const { getServices } = await import('../../services.js');
      const services = getServices();

      vi.spyOn(services.rateLimitService, 'checkLimits').mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'daily_cost_limit',
          message: 'Daily cost limit of $20 reached ($15 spent today)',
          retryAfter: 'tomorrow',
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
      expect(body.error.code).toBe('daily_cost_limit');
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
      expect(body.error.code).toBe('monthly_cost_limit');
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
      expect(body.error.code).toBe('prompt_too_long');
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
      expect(body.error.code).toBe('service_unavailable');
    });

    it('allows submissions when within limits', async () => {
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
      expect(body.error.code).toBe('DUPLICATE_PROMPT');
      expect(body.error.existingTaskId).toBeDefined();
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
      expect(body.error.code).toBe('ACTIVE_TASK_EXISTS');
    });
  });

  describe('error handling', () => {
    it('returns 503 when worker dispatch fails', async () => {
      // Mock linearIssueService to create a new Linear issue
      const linearService = getServices().linearIssueService;
      vi.spyOn(linearService, 'ensureIssueExists').mockResolvedValue({
        linearIssueId: 'INT-123',
        linearIssueTitle: 'Fix the bug',
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
          code: 'DISPATCH_FAILED',
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
      const workerTypes = ['opus', 'auto', 'glm'] as const;

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
