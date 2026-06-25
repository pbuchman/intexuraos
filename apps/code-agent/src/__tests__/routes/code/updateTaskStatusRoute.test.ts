/**
 * Tests for PATCH /internal/code-tasks/:id/status
 *
 * Dedicated, minimal endpoint for the orchestrator to commit terminal task
 * status to Firestore. Authed via X-Internal-Auth + orchestratorSecret HMAC.
 * Idempotent: no-ops when task already terminal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import crypto from 'node:crypto';
import { buildServer } from '../../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../../services.js';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { ok, err } from '@intexuraos/common-core';
import * as webhookValidation from '../../../infra/webhookValidation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(
  body: unknown,
  secret: string
): { rawBody: string; timestamp: string; signature: string } {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return { rawBody, timestamp, signature };
}

const ORCHESTRATOR_SECRET = 'test-orchestrator-secret';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';
const TASK_ID = 'task-abc';
const WEBHOOK_SECRET = 'test-task-webhook-secret';

describe('PATCH /internal/code-tasks/:id/status', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
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

    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(
        ok({
          id: TASK_ID,
          repository: 'pbuchman/intexuraos',
          userId: 'user-123',
          status: 'running',
          webhookSecret: WEBHOOK_SECRET,
          callbackState: {
            webhookUrl: 'https://intexuraos.cloud/api/code/internal/webhooks/task-complete',
            callbackBaseUrl: 'https://intexuraos.cloud/api/code',
            owner: 'prod',
            configuredAt: new Date('2026-06-09T14:00:00.000Z'),
          },
        })
      ),
      update: vi.fn().mockResolvedValue(
        ok({
          id: TASK_ID,
          repository: 'pbuchman/intexuraos',
          userId: 'user-123',
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

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function sendUpdate(
    id: string,
    body: unknown,
    overrides?: { token?: string | null; skipSignature?: boolean; badSignature?: boolean; signatureSecret?: string }
  ) {
    const { rawBody, timestamp, signature } = sign(body, overrides?.signatureSecret ?? ORCHESTRATOR_SECRET);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (overrides?.token === undefined) {
      headers['x-internal-auth'] = INTERNAL_AUTH_TOKEN;
    } else if (overrides.token !== null) {
      headers['x-internal-auth'] = overrides.token;
    }

    if (overrides?.skipSignature !== true) {
      headers['x-request-timestamp'] = timestamp;
      headers['x-request-signature'] = overrides?.badSignature === true
        ? 'a'.repeat(signature.length)
        : signature;
    }

    return app.inject({
      method: 'PATCH',
      url: `/internal/code-tasks/${id}/status`,
      headers,
      payload: rawBody,
    });
  }

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('updates task from running→failed and persists error + result', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
      error: { code: 'TIMEOUT', message: 'Worker timed out' },
      result: { prUrl: 'https://github.com/x/y/pull/1', branch: 'feat/abc', summary: 'x' },
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(200);
    const json = response.json() as { success: boolean; data: { received: boolean } };
    expect(json.success).toBe(true);
    expect(json.data.received).toBe(true);

    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
    const [calledTaskId, updateFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledTaskId).toBe(TASK_ID);
    expect(updateFields['status']).toBe('failed');
    expect(updateFields['completedAt']).toBeInstanceOf(Date);
    expect((updateFields['completedAt'] as Date).toISOString()).toBe('2026-04-17T12:00:00.000Z');
    expect(updateFields['error']).toEqual({ code: 'TIMEOUT', message: 'Worker timed out' });
    expect(updateFields['result']).toEqual({
      prUrl: 'https://github.com/x/y/pull/1',
      branch: 'feat/abc',
      summary: 'x',
    });
  });

  it('updates task with only required fields (no error → error:null, no result)', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(200);
    const [, updateFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(updateFields['status']).toBe('failed');
    // `error` is always written: either the provided value or explicit null to
    // clear any stale error captured during the `running` phase. Mirrors the
    // existing /internal/webhooks/task-complete behavior this endpoint replaces.
    expect(updateFields['error']).toBeNull();
    expect(updateFields).not.toHaveProperty('result');
  });

  // -----------------------------------------------------------------------
  // Error-field clearing on success
  //
  // The existing /internal/webhooks/task-complete handler writes `error: null`
  // on success to clear any stale error captured during `running`. This
  // endpoint replaces that handler as the primary status writer, so it must
  // mirror the behavior to avoid leaving stale errors on tasks that went
  // running→implemented via this path.
  // -----------------------------------------------------------------------

  it('clears stale error field when status is completed and no error is provided', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(
      ok({
        id: TASK_ID,
        repository: 'pbuchman/intexuraos',
        userId: 'user-123',
        status: 'running',
        agentType: 'execution',
        error: { code: 'TRANSIENT', message: 'prev' },
      })
    );

    const body = {
      taskId: TASK_ID,
      status: 'completed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(200);
    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
    const [, updateFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(updateFields['status']).toBe('implemented');
    expect(updateFields['error']).toBeNull();
  });

  it('persists explicit error (does not null it out) when status is failed', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
      error: { code: 'X', message: 'y' },
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(200);
    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
    const [, updateFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(updateFields['error']).toEqual({ code: 'X', message: 'y' });
  });

  // -----------------------------------------------------------------------
  // 'completed' → agent-type-specific mapping
  //
  // The Firestore TaskStatus type does not include 'completed'; it uses
  // 'planned' | 'implemented' | 'reviewed' based on task.agentType. This
  // mirrors the existing /internal/webhooks/task-complete webhook mapping
  // (webhookRoutes.ts around line 1451) so the stored Firestore status is
  // consistent across both paths.
  // -----------------------------------------------------------------------

  it.each([
    ['execution', 'implemented'],
    ['review', 'reviewed'],
    ['planning', 'planned'],
    ['remediation', 'implemented'],
  ] as const)(
    "maps status: 'completed' to stored status '%s' when agentType is '%s'",
    async (agentType, expectedStoredStatus) => {
      mockCodeTaskRepo.findById.mockResolvedValue(
        ok({
          id: TASK_ID,
          repository: 'pbuchman/intexuraos',
          userId: 'user-123',
          status: 'running',
          agentType,
        })
      );

      const body = {
        taskId: TASK_ID,
        status: 'completed',
        completedAt: '2026-04-17T12:00:00.000Z',
      };

      const response = await sendUpdate(TASK_ID, body);

      expect(response.statusCode).toBe(200);
      expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
      const [, updateFields] = mockCodeTaskRepo.update.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(updateFields['status']).toBe(expectedStoredStatus);
    }
  );

  it("passes non-'completed' status through unchanged regardless of agentType", async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(
      ok({
        id: TASK_ID,
        repository: 'pbuchman/intexuraos',
        userId: 'user-123',
        status: 'running',
        agentType: 'planning',
      })
    );

    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(200);
    const [, updateFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(updateFields['status']).toBe('failed');
  });

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  it('returns 200 no-op when task is already in terminal state', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(
      ok({
        id: TASK_ID,
        repository: 'pbuchman/intexuraos',
        userId: 'user-123',
        status: 'completed',
      })
    );

    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(200);
    const json = response.json() as { success: boolean; data: { received: boolean } };
    expect(json.data.received).toBe(true);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it.each([
    'completed',
    'failed',
    'interrupted',
    'cancelled',
    'implemented',
    'planned',
    'reviewed',
    'archived',
  ] as const)(
    'returns 200 no-op when task status is already %s',
    async (terminalStatus) => {
      mockCodeTaskRepo.findById.mockResolvedValue(
        ok({
          id: TASK_ID,
          repository: 'pbuchman/intexuraos',
          userId: 'user-123',
          status: terminalStatus,
        })
      );

      const body = {
        taskId: TASK_ID,
        status: 'failed',
        completedAt: '2026-04-17T12:00:00.000Z',
      };

      const response = await sendUpdate(TASK_ID, body);

      expect(response.statusCode).toBe(200);
      expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
    }
  );

  // -----------------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------------

  it('returns 401 when X-Internal-Auth is missing', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };
    const { rawBody, timestamp, signature } = sign(body, ORCHESTRATOR_SECRET);

    const response = await app.inject({
      method: 'PATCH',
      url: `/internal/code-tasks/${TASK_ID}/status`,
      headers: {
        'content-type': 'application/json',
        'x-request-timestamp': timestamp,
        'x-request-signature': signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(401);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('accepts a terminal status update signed with the task webhook secret without internal auth', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'completed',
      completedAt: '2026-04-17T12:00:00.000Z',
      result: { summary: 'Reviewed successfully' },
    };

    const response = await sendUpdate(TASK_ID, body, {
      token: null,
      signatureSecret: WEBHOOK_SECRET,
    });

    expect(response.statusCode).toBe(200);
    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
    const [, updateFields] = mockCodeTaskRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(updateFields['status']).toBe('implemented');
    expect(updateFields['result']).toEqual({ summary: 'Reviewed successfully' });
    expect(updateFields['callbackState']).toEqual(
      expect.objectContaining({
        callbackBaseUrl: 'https://intexuraos.cloud/api/code',
        lastSuccessEndpoint: 'status',
        lastSuccessAt: expect.any(Date),
      })
    );
  });

  it('accepts a task-webhook signed status update with internal auth without trying orchestrator HMAC', async () => {
    const validateOrchestratorSpy = vi.spyOn(
      webhookValidation,
      'validateOrchestratorSignature'
    );
    const body = {
      taskId: TASK_ID,
      status: 'completed',
      completedAt: '2026-04-17T12:00:00.000Z',
      result: { summary: 'Reviewed successfully' },
    };

    const response = await sendUpdate(TASK_ID, body, {
      signatureSecret: WEBHOOK_SECRET,
    });

    expect(response.statusCode).toBe(200);
    expect(validateOrchestratorSpy).not.toHaveBeenCalled();
    expect(mockCodeTaskRepo.update).toHaveBeenCalledOnce();
  });

  it('returns 401 for task-signed status update when the task has no webhook secret', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(
      ok({
        id: TASK_ID,
        repository: 'pbuchman/intexuraos',
        userId: 'user-123',
        status: 'running',
      })
    );
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body, {
      token: null,
      signatureSecret: WEBHOOK_SECRET,
    });

    expect(response.statusCode).toBe(401);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns 401 when the repository returns a mismatched task id for task-signed auth', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(
      ok({
        id: 'task-other',
        repository: 'pbuchman/intexuraos',
        userId: 'user-123',
        status: 'running',
        webhookSecret: WEBHOOK_SECRET,
      })
    );
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body, {
      token: null,
      signatureSecret: WEBHOOK_SECRET,
    });

    expect(response.statusCode).toBe(401);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns 401 when HMAC signature is invalid', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body, { badSignature: true });

    expect(response.statusCode).toBe(401);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns 401 when signature headers are missing', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body, { skipSignature: true });

    expect(response.statusCode).toBe(401);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Lookup
  // -----------------------------------------------------------------------

  it('returns 404 when task does not exist', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Task not found' })
    );

    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(404);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns 401 when task does not exist and internal auth is absent', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(
      err({ code: 'NOT_FOUND', message: 'Task not found' })
    );

    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body, {
      token: null,
      signatureSecret: WEBHOOK_SECRET,
    });

    expect(response.statusCode).toBe(401);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Validation (schema)
  // -----------------------------------------------------------------------

  it('returns 400 when status is not one of the terminal enum values', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'running',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(400);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns 400 when taskId in body does not match :id path param', async () => {
    const body = {
      taskId: 'task-different',
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(400);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns 400 when request contains an unexpected field with an array value (additionalProperties:false guard)', async () => {
    // Regression guard: original bug was a schema coercing `manualSteps: string[]` →
    // `string`, which mutated the body and broke HMAC. With additionalProperties:false,
    // this shape must be rejected with 400 *before* any body mutation happens.
    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
      manualSteps: ['step 1', 'step 2'],
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(400);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  it('returns 400 when completedAt is missing', async () => {
    const body = {
      taskId: TASK_ID,
      status: 'failed',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(400);
    expect(mockCodeTaskRepo.update).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Repo failure
  // -----------------------------------------------------------------------

  it('returns 500 when repository update fails', async () => {
    mockCodeTaskRepo.update.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'boom' })
    );

    const body = {
      taskId: TASK_ID,
      status: 'failed',
      completedAt: '2026-04-17T12:00:00.000Z',
    };

    const response = await sendUpdate(TASK_ID, body);

    expect(response.statusCode).toBe(500);
  });
});
