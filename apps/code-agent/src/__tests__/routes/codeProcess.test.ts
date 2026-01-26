/**
 * Tests for POST /internal/code/process endpoint.
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
import { resetServices, setServices } from '../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import { createFirestoreCodeTaskRepository } from '../../infra/repositories/firestoreCodeTaskRepository.js';
import { createTaskDispatcherService } from '../../infra/services/taskDispatcherImpl.js';
import { createWhatsAppNotifier } from '../../infra/services/whatsappNotifierImpl.js';
import { createFirestoreLogChunkRepository } from '../../infra/repositories/firestoreLogChunkRepository.js';
import { createWorkerDiscoveryService } from '../../infra/services/workerDiscoveryImpl.js';
import { createActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import { createLinearAgentHttpClient } from '../../infra/http/linearAgentHttpClient.js';
import { createLinearIssueService } from '../../domain/services/linearIssueService.js';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LogChunkRepository } from '../../domain/repositories/logChunkRepository.js';
import type { WorkerDiscoveryService } from '../../domain/services/workerDiscovery.js';
import type { ActionsAgentClient } from '../../infra/clients/actionsAgentClient.js';
import type { WhatsAppNotifier } from '../../domain/services/whatsappNotifier.js';
import type { RateLimitService } from '../../domain/services/rateLimitService.js';
import { ok } from '@intexuraos/common-core';
import type { LinearIssueService } from '../../domain/services/linearIssueService.js';
import { createStatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';
import type { StatusMirrorService } from '../../infra/services/statusMirrorServiceImpl.js';

describe('POST /internal/code/process', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let codeTaskRepo: CodeTaskRepository;
  let taskDispatcher: TaskDispatcherService;
  let _logChunkRepo: LogChunkRepository;
  let _workerDiscovery: WorkerDiscoveryService;

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

    taskDispatcher = createTaskDispatcherService({
      logger,
      cfAccessClientId: 'test-client-id',
      cfAccessClientSecret: 'test-client-secret',
      dispatchSigningSecret: 'test-dispatch-secret',
      orchestratorMacUrl: 'https://cc-mac.intexuraos.cloud',
      orchestratorVmUrl: 'https://cc-vm.intexuraos.cloud',
    });

    _logChunkRepo = createFirestoreLogChunkRepository({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
    });
    _workerDiscovery = createWorkerDiscoveryService({ logger });

    const whatsappNotifier = createWhatsAppNotifier({
      baseUrl: 'http://whatsapp-service',
      internalAuthToken: 'test-token',
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
      workerDiscovery: _workerDiscovery,
      whatsappNotifier,
      logChunkRepo: _logChunkRepo,
      actionsAgentClient,
      rateLimitService,
      linearIssueService,
      statusMirrorService: createStatusMirrorService({
        actionsAgentClient,
        logger,
      }),
    } as {
      firestore: Firestore;
      logger: Logger;
      codeTaskRepo: CodeTaskRepository;
      taskDispatcher: TaskDispatcherService;
      workerDiscovery: WorkerDiscoveryService;
      logChunkRepo: LogChunkRepository;
      actionsAgentClient: ActionsAgentClient;
      whatsappNotifier: WhatsAppNotifier;
      rateLimitService: RateLimitService;
      linearIssueService: LinearIssueService;
      statusMirrorService: StatusMirrorService;
    });

    app = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
  });

  it('returns 401 without X-Internal-Auth header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      payload: {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-123',
        payload: {
          prompt: 'Fix the bug',
        },
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
    });
  });

  it('creates task and returns 200 with resourceUrl for valid request', async () => {
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
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-123',
        approvalEventId: 'approval-456',
        userId: 'user-123',
        payload: {
          prompt: 'Fix the bug',
          workerType: 'auto',
          repository: 'test/repo',
          baseBranch: 'main',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { status: string; codeTaskId: string; resourceUrl: string };
    expect(json.status).toBe('submitted');
    expect(json.codeTaskId).toBeDefined();
    expect(json.resourceUrl).toMatch(/^\/#\/code-tasks\/[a-zA-Z0-9_-]+$/);
  });

  it('returns 409 for duplicate approvalEventId', async () => {
    // First request
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-1',
        approvalEventId: 'approval-dup',
        userId: 'user-123',
        payload: {
          prompt: 'First request',
        },
      },
    });

    // Second request with same approvalEventId
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-2',
        approvalEventId: 'approval-dup',
        userId: 'user-123',
        payload: {
          prompt: 'Second request',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { status: string; existingTaskId: string };
    expect(json.status).toBe('duplicate');
    expect(json.existingTaskId).toBeDefined();
  });

  it('returns 409 for duplicate actionId', async () => {
    // First request
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-action',
        approvalEventId: 'approval-1',
        userId: 'user-123',
        payload: {
          prompt: 'First request',
        },
      },
    });

    // Second request with same actionId
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-action',
        approvalEventId: 'approval-2',
        userId: 'user-123',
        payload: {
          prompt: 'Second request',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { status: string; existingTaskId: string };
    expect(json.status).toBe('duplicate');
    expect(json.existingTaskId).toBeDefined();
  });

  it('returns 503 when all workers unavailable', async () => {
    // Mock taskDispatcher to return error
    const mockDispatch = vi.spyOn(taskDispatcher, 'dispatch').mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'worker_unavailable',
        message: 'No workers available',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-no-worker',
        approvalEventId: 'approval-no-worker',
        userId: 'user-123',
        payload: {
          prompt: 'Test prompt',
        },
      },
    });

    expect(response.statusCode).toBe(503);
    const json = response.json() as { status: string; error: string };
    expect(json.status).toBe('failed');
    expect(json.error).toBe('worker_unavailable');

    mockDispatch.mockRestore();
  });

  it('returns 409 for duplicate_approval even with different linearIssueId', async () => {
    // First request with linearIssueId
    await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-linear-1',
        approvalEventId: 'approval-dup-linear',
        userId: 'user-123',
        payload: {
          prompt: 'First request',
          linearIssueId: 'INT-123',
        },
      },
    });

    // Second request with same approvalEventId but different linearIssueId
    const response = await app.inject({
      method: 'POST',
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-dup-linear-2',
        approvalEventId: 'approval-dup-linear',
        userId: 'user-123',
        payload: {
          prompt: 'Second request',
          linearIssueId: 'INT-456',
        },
      },
    });

    expect(response.statusCode).toBe(409);
    const json = response.json() as { status: string; existingTaskId: string };
    expect(json.status).toBe('duplicate');
  });

  it('returns 200 with correct resourceUrl format', async () => {
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
      url: '/internal/code/process',
      headers: {
        'X-Internal-Auth': 'test-internal-token',
      },
      payload: {
        actionId: 'action-resource-url',
        approvalEventId: 'approval-resource-url',
        userId: 'user-123',
        payload: {
          prompt: 'Test resource URL format',
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const json = response.json() as { status: string; codeTaskId: string; resourceUrl: string };
    expect(json.resourceUrl).toMatch(/^\/#\/code-tasks\/[a-zA-Z0-9_-]+$/);
    // Verify resourceUrl contains the codeTaskId
    expect(json.resourceUrl).toContain(json.codeTaskId);
  });
});
