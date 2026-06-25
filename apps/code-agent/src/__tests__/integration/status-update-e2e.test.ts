/**
 * End-to-end regression test for the orchestrator → code-agent status update
 * round-trip.
 *
 * Regression guard for the "schema coerces body, HMAC mismatches, task stays
 * running" bug class that motivated the INT-1412/INT-1413 finalize-task
 * robustness PR: the orchestrator signed the raw body with HMAC, Fastify's
 * default Ajv (with `coerceTypes: true` and `removeAdditional: true`) silently
 * mutated the body before the handler recomputed the signature, and the
 * signature check rejected the request as forged. Task stayed stuck in
 * `running` forever.
 *
 * This test wires up:
 *   - the REAL orchestrator `StatusUpdateClient` (signs with orchestrator
 *     secret + real HMAC-SHA256 + real JSON serialization)
 *   - a REAL Fastify server (not `app.inject`) listening on a local port so
 *     requests traverse the socket layer — that's where any silent
 *     serialization/mutation drift would hide
 *   - the REAL `updateTaskStatusRoute` handler with its strict Ajv
 *     (`additionalProperties: false`, `coerceTypes: false`) + HMAC
 *     verification over `request.rawBody`
 *   - a mocked `codeTaskRepo` seeded with a `running` task
 *
 * If any future change to schema, signing, or body parsing re-introduces the
 * class of bugs this PR fixes, the first test fails: the 200 + persistence
 * assertion flips to 401 / signature mismatch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import pino from 'pino';
import { ok } from '@intexuraos/common-core';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';

import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
// Cross-workspace import via relative path. StatusUpdateClient has zero external
// deps (only `node:crypto` built-in and `pino` type-only), so pulling it into
// the code-agent test workspace does not break dependency resolution.
// We intentionally depend on the REAL client — its signing correctness is the
// thing under test.
import { StatusUpdateClient } from '../../../../../workers/orchestrator/src/services/status-update-client.js';

const ORCHESTRATOR_SECRET = 'shared-test-orchestrator-secret';
const INTERNAL_AUTH_TOKEN = 'shared-test-internal-auth-token';
const TASK_ID = 'task_int_e2e';

describe('StatusUpdateClient <-> updateTaskStatusRoute end-to-end', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let serverUrl: string;
  let mockCodeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findByIdForUser: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    hasActiveBlockingTaskForIssue: ReturnType<typeof vi.fn>;
    findActiveTasksForRepository: ReturnType<typeof vi.fn>;
    findByLinearIssueId: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.mocked(jose.jwtVerify).mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = INTERNAL_AUTH_TOKEN;
    process.env['INTEXURAOS_ORCHESTRATOR_SECRET'] = ORCHESTRATOR_SECRET;
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    const fakeFirestore = createFakeFirestore() as unknown as Firestore;
    setFirestore(fakeFirestore);

    // In-memory fake codeTaskRepo seeded with a task in `running` state, as
    // `findById` is called to check the current status before the handler
    // decides to mutate vs. no-op. `update` captures the persisted fields so
    // we can assert end-to-end Firestore persistence.
    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(
        ok({
          id: TASK_ID,
          repository: 'pbuchman/intexuraos',
          userId: 'user-e2e',
          status: 'running',
          agentType: 'execution',
        })
      ),
      update: vi.fn().mockResolvedValue(
        ok({
          id: TASK_ID,
          repository: 'pbuchman/intexuraos',
          userId: 'user-e2e',
          status: 'failed',
        })
      ),
      create: vi.fn(),
      findByIdForUser: vi.fn(),
      list: vi.fn(),
      hasActiveBlockingTaskForIssue: vi.fn(),
      findActiveTasksForRepository: vi.fn(),
      findByLinearIssueId: vi.fn(),
    };

    const logger = pino({ level: 'silent' });

    setServices({
      firestore: fakeFirestore,
      logger,
      codeTaskRepo: mockCodeTaskRepo as never,
      automationLog: {} as never,
      logChunkRepo: {} as never,
      logLineRepo: {} as never,
      taskDispatcher: {} as never,
      whatsappNotifier: {} as never,
      linearAgentClient: {} as never,
      linearIssueService: {} as never,
      processHeartbeat: {} as never,
      detectZombieTasks: {} as never,
      archiveStaleGroups: {} as never,
      autoArchiveMergedTasks: {} as never,
      metricsClient: {} as never,
      workerSettingsRepo: {} as never,
      workerHealthProbe: {} as never,
      gitHubPREventRepo: {} as never,
      gitHubPRSummaryRepo: {} as never,
      turnMetricsRepo: {} as never,
      userServiceClient: {} as never,
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
      resolveToolCallingClient: (() => {
        throw new Error('unused');
      }) as never,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
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
      prTriagePublisher: {} as never,
    } as ServiceContainer);

    app = await buildServer();
    // Listen on an ephemeral port so the request traverses the real socket
    // layer — `app.inject` would bypass the HTTP parser and hide any raw-body
    // drift that HMAC verification depends on.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('unexpected fastify server address (pipe or null)');
    }
    serverUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    resetFirestore();
    vi.clearAllMocks();
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_ORCHESTRATOR_SECRET'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  });

  it('orchestrator client commits status=failed and code-agent persists it', async () => {
    const client = new StatusUpdateClient({
      codeAgentUrl: serverUrl,
      orchestratorSecret: ORCHESTRATOR_SECRET,
      internalAuthToken: INTERNAL_AUTH_TOKEN,
      logger: pino({ level: 'silent' }),
      // No retries: a single attempt is enough for the happy path, and keeps
      // the test fast. `maxAttempts = retryDelaysMs.length + 1 = 1`. See
      // StatusUpdateClient constructor.
      retryDelaysMs: [],
    });

    const completedAt = new Date('2026-04-17T18:10:27.316Z');
    const result = await client.commit({
      taskId: TASK_ID,
      status: 'failed',
      completedAt,
      error: {
        code: 'TASK_COMPLETION_VERIFICATION_FAILED',
        message: 'Missing fields: memory_acknowledgment',
      },
      result: {
        prUrl: 'https://github.com/x/y/pull/1',
        branch: 'fix/x',
        summary: '[INT-X] example',
      },
    });

    expect(result.ok).toBe(true);

    // End-to-end persistence: the handler must have reached `codeTaskRepo.update`
    // with the decoded body. If schema/HMAC drift ever re-emerges, the request
    // would be rejected with 401 before reaching this line.
    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
    const [persistedTaskId, persistedFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(persistedTaskId).toBe(TASK_ID);
    expect(persistedFields['status']).toBe('failed');
    expect(persistedFields['completedAt']).toBeInstanceOf(Date);
    expect((persistedFields['completedAt'] as Date).toISOString()).toBe(
      '2026-04-17T18:10:27.316Z'
    );
    expect(persistedFields['error']).toEqual({
      code: 'TASK_COMPLETION_VERIFICATION_FAILED',
      message: 'Missing fields: memory_acknowledgment',
    });
    expect(persistedFields['result']).toEqual({
      prUrl: 'https://github.com/x/y/pull/1',
      branch: 'fix/x',
      summary: '[INT-X] example',
    });
  });

  it("maps status='completed' to 'implemented' for agentType='execution' end-to-end", async () => {
    // Same seeded task (agentType='execution', status='running'). The handler
    // must map the orchestrator-vocabulary 'completed' to code-agent's
    // execution-agent terminal status 'implemented' per updateTaskStatusRoute
    // mapping — mirroring /internal/webhooks/task-complete.
    const client = new StatusUpdateClient({
      codeAgentUrl: serverUrl,
      orchestratorSecret: ORCHESTRATOR_SECRET,
      internalAuthToken: INTERNAL_AUTH_TOKEN,
      logger: pino({ level: 'silent' }),
      retryDelaysMs: [],
    });

    const result = await client.commit({
      taskId: TASK_ID,
      status: 'completed',
      completedAt: new Date('2026-04-17T19:00:00.000Z'),
      result: {
        prUrl: 'https://github.com/x/y/pull/2',
        branch: 'feat/e2e',
        summary: '[INT-E2E] example',
      },
    });

    expect(result.ok).toBe(true);

    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
    const [, persistedFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    // `completed` → `implemented` for execution agents. Non-negotiable: the
    // Firestore TaskStatus type does not include 'completed'.
    expect(persistedFields['status']).toBe('implemented');
    // `error: null` is written to clear any stale error from the running phase,
    // mirroring webhookRoutes.ts behavior.
    expect(persistedFields['error']).toBeNull();
    expect(persistedFields['result']).toEqual({
      prUrl: 'https://github.com/x/y/pull/2',
      branch: 'feat/e2e',
      summary: '[INT-E2E] example',
    });
  });
});
