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
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
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
      baseUrl: 'http://whatsapp-service',
      internalAuthToken: 'test-token',
      logger,
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
      linearIssueService,
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      workerDiscovery: WorkerDiscoveryService;
      taskDispatcher: TaskDispatcherService;
      logChunkRepo: LogChunkRepository;
      actionsAgentClient: ActionsAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      linearIssueService: LinearIssueService;
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
    it('returns 429 when daily limit exceeded', async () => {
      // Mock successful dispatch
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      // Create 10 existing tasks for today to hit the limit
      // Note: Use the same userId that JWT validation returns ('test-user-id')
      for (let i = 0; i < 10; i++) {
        const result = await codeTaskRepo.create({
          userId: 'test-user-id',  // This is what JWT validation returns
          prompt: `Task ${i}`,
          sanitizedPrompt: `Task ${i}`,
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: `trace_${i}`,
        });

        // Verify first 10 succeed
        if (i < 10) {
          expect(result.ok).toBe(true);
        }
      }

      // Now try to submit the 11th task via the endpoint
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
      expect(body).toEqual({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Maximum 10 tasks per day',
        },
      });
    });

    it('allows submissions below daily limit', async () => {
      // Mock successful dispatch
      vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
        ok: true,
        value: {
          dispatched: true,
          workerLocation: 'mac',
        },
      });

      // Create only 5 tasks (below limit of 10)
      const userId = 'test-user-id';
      for (let i = 0; i < 5; i++) {
        await codeTaskRepo.create({
          userId,
          prompt: `Task ${i}`,
          sanitizedPrompt: `Task ${i}`,
          systemPromptHash: 'default',
          workerType: 'auto',
          workerLocation: 'mac',
          repository: 'pbuchman/intexuraos',
          baseBranch: 'development',
          traceId: `trace_${i}`,
        });
      }

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
