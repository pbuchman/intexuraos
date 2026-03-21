/**
 * Tests for POST /internal/webhooks/task-event
 *
 * Verifies HMAC signature validation, task lookup, event mapping,
 * and best-effort automation log recording.
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
import type { AutomationLog, AutomationEvent } from '../../../domain/ports/automationLog.js';
import { generateWebhookSecret } from '../../../domain/utils/secrets.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSignature(
  body: object,
  secret: string
): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify(body);
  const message = `${timestamp}.${rawBody}`;
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return { timestamp, signature };
}

const ORCHESTRATOR_SECRET = 'test-orchestrator-secret';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';
const TASK_ID = 'task-abc';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('POST /internal/webhooks/task-event', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let mockAutomationLog: { record: ReturnType<typeof vi.fn> };
  let mockCodeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findByIdForUser: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
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

    mockAutomationLog = { record: vi.fn().mockResolvedValue(undefined) };
    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(ok({
        id: TASK_ID,
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        userId: 'user-123',
        status: 'running',
        webhookSecret: generateWebhookSecret(ORCHESTRATOR_SECRET, TASK_ID),
      })),
      create: vi.fn(),
      findByIdForUser: vi.fn(),
      update: vi.fn(),
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
      automationLog: mockAutomationLog as AutomationLog,
      // Remaining services are not used by the task-event route
      logChunkRepo: {} as never,
      logLineRepo: {} as never,
      taskDispatcher: {} as never,
      whatsappNotifier: {} as never,
      actionsAgentClient: {} as never,
      linearAgentClient: {} as never,
      rateLimitService: {} as never,
      linearIssueService: {} as never,
      statusMirrorService: {} as never,
      processHeartbeat: {} as never,
      detectZombieTasks: {} as never,
      cleanupTaskLogs: {} as never,
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
      toolCallingClient: undefined,
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
  function sendTaskEvent(body: object, overrides?: { token?: string; skipSignature?: boolean }) {
    const headers: Record<string, string> = {
      'X-Internal-Auth': overrides?.token ?? INTERNAL_AUTH_TOKEN,
    };

    if (overrides?.skipSignature !== true) {
      const bodyTaskId = (body as { taskId?: string }).taskId ?? '';
      const perTaskSecret = generateWebhookSecret(ORCHESTRATOR_SECRET, bodyTaskId);
      const { timestamp, signature } = generateSignature(body, perTaskSecret);
      headers['X-Request-Timestamp'] = timestamp;
      headers['X-Request-Signature'] = signature;
    }

    return app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-event',
      headers,
      payload: body,
    });
  }

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  it('rejects request without X-Internal-Auth header', async () => {
    const body = { taskId: TASK_ID, event: 'task_started', attempt: 1, workerType: 'opus' };
    const perTaskSecret = generateWebhookSecret(ORCHESTRATOR_SECRET, TASK_ID);
    const { timestamp, signature } = generateSignature(body, perTaskSecret);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-event',
      headers: {
        'X-Request-Timestamp': timestamp,
        'X-Request-Signature': signature,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects request with invalid webhook signature', async () => {
    const body = { taskId: TASK_ID, event: 'task_started', attempt: 1, workerType: 'opus' };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-event',
      headers: {
        'X-Internal-Auth': INTERNAL_AUTH_TOKEN,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        'X-Request-Signature': 'invalid-signature',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects request without timestamp header', async () => {
    const body = { taskId: TASK_ID, event: 'task_started', attempt: 1, workerType: 'opus' };

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/task-event',
      headers: {
        'X-Internal-Auth': INTERNAL_AUTH_TOKEN,
        'X-Request-Signature': 'some-sig',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  it('returns 400 for missing taskId', async () => {
    const body = { event: 'task_started', attempt: 1, workerType: 'opus' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(400);
  });

  it('returns 401 for empty taskId (caught by signature validation)', async () => {
    const body = { taskId: '', event: 'task_started' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 for unknown event type', async () => {
    const body = { taskId: 'task-abc', event: 'unknown_event' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(400);
  });

  // -----------------------------------------------------------------------
  // Task lookup
  // -----------------------------------------------------------------------

  it('returns 401 when task is not found (webhook secret unavailable)', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'NOT_FOUND', message: 'Task not found' }));

    const body = { taskId: 'task-nonexistent', event: 'task_started', attempt: 1, workerType: 'opus' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when task has no webhook secret', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      id: TASK_ID,
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-123',
      status: 'running',
    }));

    const body = { taskId: TASK_ID, event: 'task_started', attempt: 1, workerType: 'opus' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(401);
  });

  it('returns 200 when task disappears between signature validation and lookup', async () => {
    // First findById call (signature validation) succeeds, second call (route body) fails
    mockCodeTaskRepo.findById
      .mockResolvedValueOnce(ok({
        id: TASK_ID,
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        userId: 'user-123',
        status: 'running',
        webhookSecret: generateWebhookSecret(ORCHESTRATOR_SECRET, TASK_ID),
      }))
      .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'Task not found' }));

    const body = { taskId: TASK_ID, event: 'task_started', attempt: 1, workerType: 'opus' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);
    expect(mockAutomationLog.record).not.toHaveBeenCalled();
  });

  it('returns 200 and logs warning when task has no prNumber', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(ok({
      id: TASK_ID,
      repository: 'pbuchman/intexuraos',
      prNumber: undefined,
      userId: 'user-123',
      status: 'running',
      webhookSecret: generateWebhookSecret(ORCHESTRATOR_SECRET, TASK_ID),
    }));

    const body = { taskId: TASK_ID, event: 'task_started', attempt: 1, workerType: 'opus' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);
    expect(mockAutomationLog.record).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Event mapping: task_started
  // -----------------------------------------------------------------------

  it('records task_started event', async () => {
    const body = { taskId: 'task-abc', event: 'task_started', attempt: 2, workerType: 'opus' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);
    const json = response.json() as { received: boolean };
    expect(json.received).toBe(true);

    expect(mockAutomationLog.record).toHaveBeenCalledOnce();
    const [prRef, event, userId] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent, string];
    expect(prRef).toEqual({ repository: 'pbuchman/intexuraos', prNumber: 42 });
    expect(event).toEqual({
      type: 'task_started',
      taskId: 'task-abc',
      workerType: 'opus',
      attempt: 2,
    });
    expect(userId).toBe('user-123');
  });

  it('defaults attempt to 1 and workerType to unknown when not provided for task_started', async () => {
    const body = { taskId: 'task-abc', event: 'task_started' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);

    const [, event] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent];
    expect(event).toEqual({
      type: 'task_started',
      taskId: 'task-abc',
      workerType: 'unknown',
      attempt: 1,
    });
  });

  // -----------------------------------------------------------------------
  // Event mapping: task_completed
  // -----------------------------------------------------------------------

  it('records task_completed event with commits', async () => {
    const body = {
      taskId: 'task-abc',
      event: 'task_completed',
      status: 'implemented',
      duration: 120000,
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
      commits: [{ sha: 'abc123', message: 'fix: auth bug' }],
    };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);

    const [, event] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent];
    expect(event).toEqual({
      type: 'task_completed',
      taskId: 'task-abc',
      status: 'implemented',
      duration: 120000,
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
      commits: [{ sha: 'abc123', message: 'fix: auth bug' }],
    });
  });

  it('defaults duration to 0 and status to unknown for task_completed', async () => {
    const body = { taskId: 'task-abc', event: 'task_completed' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);

    const [, event] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent];
    expect(event).toEqual({
      type: 'task_completed',
      taskId: 'task-abc',
      status: 'unknown',
      duration: 0,
    });
  });

  // -----------------------------------------------------------------------
  // Event mapping: task_failed
  // -----------------------------------------------------------------------

  it('records task_failed event', async () => {
    const body = {
      taskId: 'task-abc',
      event: 'task_failed',
      error: { code: 'TIMEOUT', message: 'Worker timed out' },
      duration: 300000,
    };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);

    const [, event] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent];
    expect(event).toEqual({
      type: 'task_failed',
      taskId: 'task-abc',
      error: 'Worker timed out',
      errorCode: 'TIMEOUT',
      duration: 300000,
    });
  });

  it('uses default error message when error object is missing for task_failed', async () => {
    const body = { taskId: 'task-abc', event: 'task_failed' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);

    const [, event] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent];
    expect(event).toEqual({
      type: 'task_failed',
      taskId: 'task-abc',
      error: 'Unknown error',
    });
  });

  // -----------------------------------------------------------------------
  // Event mapping: task_interrupted
  // -----------------------------------------------------------------------

  it('records task_interrupted event with duration', async () => {
    const body = { taskId: 'task-abc', event: 'task_interrupted', duration: 60000 };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);

    const [, event] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent];
    expect(event).toEqual({
      type: 'task_interrupted',
      taskId: 'task-abc',
      duration: 60000,
    });
  });

  it('records task_interrupted event without duration', async () => {
    const body = { taskId: 'task-abc', event: 'task_interrupted' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);

    const [, event] = mockAutomationLog.record.mock.calls[0] as [unknown, AutomationEvent];
    expect(event).toEqual({
      type: 'task_interrupted',
      taskId: 'task-abc',
    });
  });

  // -----------------------------------------------------------------------
  // Best-effort: automationLog failure does not fail the request
  // -----------------------------------------------------------------------

  it('returns 200 even when automationLog.record throws', async () => {
    mockAutomationLog.record.mockRejectedValue(new Error('Firestore down'));

    const body = { taskId: 'task-abc', event: 'task_started', attempt: 1, workerType: 'opus' };
    const response = await sendTaskEvent(body);

    expect(response.statusCode).toBe(200);
  });
});
