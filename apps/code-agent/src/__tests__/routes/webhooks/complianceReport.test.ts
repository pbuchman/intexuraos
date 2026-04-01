/**
 * Tests for POST /internal/webhooks/compliance-report
 *
 * Verifies HMAC signature validation, Firestore subcollection storage,
 * and proper response format.
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
const TASK_ID = 'task-compliance-abc';

function buildValidPayload(): Record<string, unknown> {
  return {
    taskId: TASK_ID,
    prNumber: 42,
    report: {
      claimVerification: {
        ciTrackedCalled: { called: true, exitCode: 0, msgRef: 'msg_001' },
        prCreated: { created: true, url: 'https://github.com/org/repo/pull/42', msgRef: 'msg_002' },
        commitCount: 3,
        summaryAccurate: true,
        summaryContradictions: [],
      },
      contractCompliance: {
        subagentDrivenDevInvoked: { invoked: true, msgRef: 'msg_003' },
        requestingCodeReviewInvoked: { invoked: true, msgRef: 'msg_004' },
        codeReviewerDispatched: { dispatched: true, msgRef: 'msg_005' },
        correctOrder: true,
        skillViolations: [],
      },
      anomalies: [],
      executionMetrics: {
        totalMessages: 45,
        hookViolationCount: 0,
        toolErrorCount: 2,
        subagentDispatchCount: 1,
      },
    },
    model: 'claude-opus-4-20250514',
    promptVersion: '1.0.0',
    costUsd: 0.42,
    workerType: 'opus',
    transcriptTooLong: false,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('POST /internal/webhooks/compliance-report', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: Firestore;
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

    fakeFirestore = createFakeFirestore() as unknown as Firestore;
    setFirestore(fakeFirestore);

    mockCodeTaskRepo = {
      findById: vi.fn().mockResolvedValue(ok({
        id: TASK_ID,
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        userId: 'user-123',
        status: 'completed',
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
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      archiveStaleGroups: {} as never,
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
  function sendComplianceReport(body: object, overrides?: { token?: string; skipAuth?: boolean; skipSignature?: boolean }) {
    const headers: Record<string, string> = {};

    if (overrides?.skipAuth !== true) {
      headers['X-Internal-Auth'] = overrides?.token ?? INTERNAL_AUTH_TOKEN;
    }

    if (overrides?.skipSignature !== true) {
      const bodyTaskId = (body as { taskId?: string }).taskId ?? '';
      const perTaskSecret = generateWebhookSecret(ORCHESTRATOR_SECRET, bodyTaskId);
      const { timestamp, signature } = generateSignature(body, perTaskSecret);
      headers['X-Request-Timestamp'] = timestamp;
      headers['X-Request-Signature'] = signature;
    }

    return app.inject({
      method: 'POST',
      url: '/internal/webhooks/compliance-report',
      headers,
      payload: body,
    });
  }

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  it('rejects request without X-Internal-Auth header', async () => {
    const body = buildValidPayload();
    const perTaskSecret = generateWebhookSecret(ORCHESTRATOR_SECRET, TASK_ID);
    const { timestamp, signature } = generateSignature(body, perTaskSecret);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/compliance-report',
      headers: {
        'X-Request-Timestamp': timestamp,
        'X-Request-Signature': signature,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects request with invalid webhook signature', async () => {
    const body = buildValidPayload();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/compliance-report',
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
    const body = buildValidPayload();

    const response = await app.inject({
      method: 'POST',
      url: '/internal/webhooks/compliance-report',
      headers: {
        'X-Internal-Auth': INTERNAL_AUTH_TOKEN,
        'X-Request-Signature': 'some-sig',
      },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
  });

  // -----------------------------------------------------------------------
  // Successful storage
  // -----------------------------------------------------------------------

  it('stores compliance report in Firestore and returns 200 with success:true', async () => {
    const body = buildValidPayload();
    const response = await sendComplianceReport(body);

    expect(response.statusCode).toBe(200);
    const json = response.json() as { success: boolean };
    expect(json.success).toBe(true);

    // Verify document was stored in subcollection
    const snapshot = await fakeFirestore
      .collection('code_tasks')
      .doc(TASK_ID)
      .collection('compliance_reports')
      .get();

    expect(snapshot.docs).toHaveLength(1);
    const stored = snapshot.docs[0]?.data();
    expect(stored).toBeDefined();
    expect(stored?.['taskId']).toBe(TASK_ID);
    expect(stored?.['prNumber']).toBe(42);
    expect(stored?.['model']).toBe('claude-opus-4-20250514');
    expect(stored?.['promptVersion']).toBe('1.0.0');
    expect(stored?.['costUsd']).toBe(0.42);
    expect(stored?.['workerType']).toBe('opus');
    expect(stored?.['transcriptTooLong']).toBe(false);
    expect(stored?.['report']).toEqual(body['report' as keyof typeof body]);
    expect(stored?.['createdAt']).toBeDefined();
  });

  it('stores report with anomalies correctly', async () => {
    const body = buildValidPayload();
    (body as Record<string, unknown>)['report'] = {
      ...(body['report' as keyof typeof body] as Record<string, unknown>),
      anomalies: [
        {
          type: 'hook_violation',
          severity: 'high',
          msgRef: 'msg_010',
          description: 'Skipped pre-commit hook',
        },
      ],
    };

    const response = await sendComplianceReport(body);

    expect(response.statusCode).toBe(200);

    const snapshot = await fakeFirestore
      .collection('code_tasks')
      .doc(TASK_ID)
      .collection('compliance_reports')
      .get();

    const stored = snapshot.docs[0]?.data();
    expect((stored?.['report'] as Record<string, unknown>)?.['anomalies']).toEqual([
      {
        type: 'hook_violation',
        severity: 'high',
        msgRef: 'msg_010',
        description: 'Skipped pre-commit hook',
      },
    ]);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it('returns 401 when task is not found (webhook secret unavailable)', async () => {
    mockCodeTaskRepo.findById.mockResolvedValue(err({ code: 'NOT_FOUND', message: 'Task not found' }));

    const body = buildValidPayload();
    const response = await sendComplianceReport(body);

    expect(response.statusCode).toBe(401);
  });

  it('returns 500 when Firestore write fails', async () => {
    // Make the task lookup succeed for signature validation, but make Firestore write fail
    const brokenFirestore = {
      collection: (): object => ({
        doc: (): object => ({
          collection: (): object => ({
            add: (): Promise<never> => Promise.reject(new Error('Firestore write failed')),
          }),
        }),
      }),
    } as unknown as Firestore;

    // Re-set services with the broken firestore (but keep the real one for task lookup)
    const logger = pino({ level: 'silent' });
    setServices({
      firestore: brokenFirestore,
      logger,
      codeTaskRepo: mockCodeTaskRepo as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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
      archiveStaleGroups: {} as never,
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

    const body = buildValidPayload();
    const response = await sendComplianceReport(body);

    expect(response.statusCode).toBe(500);
  });
});
