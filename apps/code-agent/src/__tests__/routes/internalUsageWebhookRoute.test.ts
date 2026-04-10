/**
 * Tests for POST /internal/webhooks/usage-events
 *
 * Covers:
 * - Missing X-Internal-Auth -> 401
 * - Valid X-Internal-Auth but missing HMAC headers -> 401
 * - Valid X-Internal-Auth but invalid HMAC signature -> 401
 * - Valid auth + valid HMAC + valid body -> 200 with forwarded response
 * - Valid auth + valid HMAC + usageServiceClient error -> 500
 * - Valid auth + valid HMAC + empty events array -> 200
 * - usageServiceClient not configured -> 503
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import crypto from 'node:crypto';
import { buildServer } from '../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../services.js';
import { createFakeFirestore, setFirestore, resetFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import { ok, err } from '@intexuraos/common-core';
import type { UsageServiceClient, UsageIngestResponse, UsageServiceError } from '@intexuraos/internal-clients';
import { LlmProviders } from '@intexuraos/llm-contract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORCHESTRATOR_SECRET = 'test-orchestrator-secret';
const INTERNAL_AUTH_TOKEN = 'test-internal-token';

function generateOrchestratorSignature(
  body: object,
  secret: string
): { timestamp: string; signature: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify(body);
  const message = `${timestamp}.${rawBody}`;
  const signature = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return { timestamp, signature };
}

function buildValidPayload(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    events: [
      {
        schemaVersion: 1,
        eventId: 'evt-001',
        occurredAt: '2026-04-10T12:00:00Z',
        owner: { type: 'user', id: 'user-1' },
        source: { service: 'code-agent', component: 'orchestrator', client: 'cli', environment: 'dev' },
        request: { provider: LlmProviders.Anthropic, model: 'claude-sonnet-4-20250514', operation: 'generate', success: true, durationMs: 1500 },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0, cachedTokens: 0, reasoningTokens: 0, thinkingTokens: 0, webSearchCalls: 0, groundingEnabled: false, imageCount: 0 },
        cost: { billedUsd: 0.01, providerReportedUsd: null, calculatedUsd: 0.01, pricingSource: 'calculated' },
        correlation: { requestId: null, traceId: null, taskId: 'task_abc', researchId: null, attempt: null, sessionId: null },
        error: null,
      },
    ],
  };
}

function createMockUsageServiceClient(): UsageServiceClient {
  return {
    ingestEvents: vi.fn<UsageServiceClient['ingestEvents']>(),
    queryUsage: vi.fn<UsageServiceClient['queryUsage']>(),
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('POST /internal/webhooks/usage-events', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let fakeFirestore: Firestore;
  let mockUsageServiceClient: UsageServiceClient;

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

    mockUsageServiceClient = createMockUsageServiceClient();
    vi.mocked(mockUsageServiceClient.ingestEvents).mockResolvedValue(
      ok({ accepted: 1, duplicates: 0, rejected: [] } satisfies UsageIngestResponse)
    );

    const logger = pino({ level: 'silent' });

    setServices({
      firestore: fakeFirestore,
      logger,
      usageServiceClient: mockUsageServiceClient,
      codeTaskRepo: {} as never,
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
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      taskEnqueueService: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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

  // -----------------------------------------------------------------------
  // Helper to send requests
  // -----------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function sendUsageEvents(
    body: object,
    overrides?: { skipAuth?: boolean; skipSignature?: boolean; invalidSignature?: boolean }
  ) {
    const headers: Record<string, string> = {};

    if (overrides?.skipAuth !== true) {
      headers['X-Internal-Auth'] = INTERNAL_AUTH_TOKEN;
    }

    if (overrides?.skipSignature !== true && overrides?.invalidSignature !== true) {
      const { timestamp, signature } = generateOrchestratorSignature(body, ORCHESTRATOR_SECRET);
      headers['X-Request-Timestamp'] = timestamp;
      headers['X-Request-Signature'] = signature;
    }

    if (overrides?.invalidSignature === true) {
      headers['X-Request-Timestamp'] = String(Math.floor(Date.now() / 1000));
      headers['X-Request-Signature'] = 'invalid-signature-value';
    }

    return await app.inject({
      method: 'POST',
      url: '/internal/webhooks/usage-events',
      headers,
      payload: body,
    });
  }

  // -----------------------------------------------------------------------
  // Authentication tests
  // -----------------------------------------------------------------------

  it('returns 401 when X-Internal-Auth header is missing', async () => {
    const body = buildValidPayload();
    const response = await sendUsageEvents(body, { skipAuth: true });

    expect(response.statusCode).toBe(401);
    const parsed = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when HMAC headers are missing', async () => {
    const body = buildValidPayload();
    const response = await sendUsageEvents(body, { skipSignature: true });

    expect(response.statusCode).toBe(401);
    const parsed = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when HMAC signature is invalid', async () => {
    const body = buildValidPayload();
    const response = await sendUsageEvents(body, { invalidSignature: true });

    expect(response.statusCode).toBe(401);
    const parsed = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('UNAUTHORIZED');
  });

  // -----------------------------------------------------------------------
  // Happy path
  // -----------------------------------------------------------------------

  it('returns 200 with forwarded response on valid auth + valid HMAC + valid body', async () => {
    const body = buildValidPayload();
    const response = await sendUsageEvents(body);

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body) as {
      success: boolean;
      data: UsageIngestResponse;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.accepted).toBe(1);
    expect(parsed.data.duplicates).toBe(0);
    expect(parsed.data.rejected).toEqual([]);
    expect(vi.mocked(mockUsageServiceClient.ingestEvents)).toHaveBeenCalledOnce();
  });

  it('returns 200 with empty events array', async () => {
    const body = { schemaVersion: 1, events: [] };
    vi.mocked(mockUsageServiceClient.ingestEvents).mockResolvedValue(
      ok({ accepted: 0, duplicates: 0, rejected: [] })
    );

    const response = await sendUsageEvents(body);

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.body) as {
      success: boolean;
      data: UsageIngestResponse;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.data.accepted).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Schema validation
  // -----------------------------------------------------------------------

  it('returns 400 when events contain malformed objects missing required fields', async () => {
    const body = {
      schemaVersion: 1,
      events: [
        {
          // Missing all required fields — just an arbitrary object
          foo: 'bar',
        },
      ],
    };
    const response = await sendUsageEvents(body);

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 when event has invalid provider enum value', async () => {
    const validPayload = buildValidPayload();
    const events = (validPayload as { events: Record<string, unknown>[] }).events;
    const firstEvent = events[0];
    if (firstEvent !== undefined) {
      (firstEvent as { request: Record<string, unknown> }).request = {
        ...(firstEvent as { request: Record<string, unknown> }).request,
        provider: 'invalid-provider',
      };
    }
    const response = await sendUsageEvents(validPayload);

    expect(response.statusCode).toBe(400);
  });

  // -----------------------------------------------------------------------
  // Error path
  // -----------------------------------------------------------------------

  it('returns 500 when usageServiceClient returns an error', async () => {
    const usageError: UsageServiceError = { code: 'NETWORK_ERROR', message: 'Connection refused' };
    vi.mocked(mockUsageServiceClient.ingestEvents).mockResolvedValue(err(usageError));

    const body = buildValidPayload();
    const response = await sendUsageEvents(body);

    expect(response.statusCode).toBe(500);
    const parsed = JSON.parse(response.body) as { success: boolean; error: { code: string; message: string } };
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('INTERNAL_ERROR');
  });

  // -----------------------------------------------------------------------
  // Service unavailable
  // -----------------------------------------------------------------------

  it('returns 503 when usageServiceClient is not configured', async () => {
    const logger = pino({ level: 'silent' });
    setServices({
      firestore: fakeFirestore,
      logger,
      codeTaskRepo: {} as never,
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
      toolCallingClient: undefined,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: {} as never,
      taskEnqueueService: {} as never,
      automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
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

    // Need a new app instance since services changed
    const newApp = await buildServer();

    const body = buildValidPayload();
    const { timestamp, signature } = generateOrchestratorSignature(body, ORCHESTRATOR_SECRET);
    const response = await newApp.inject({
      method: 'POST',
      url: '/internal/webhooks/usage-events',
      headers: {
        'X-Internal-Auth': INTERNAL_AUTH_TOKEN,
        'X-Request-Timestamp': timestamp,
        'X-Request-Signature': signature,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(503);
    const parsed = JSON.parse(response.body) as { success: boolean; error: { code: string } };
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('MISCONFIGURED');

    await newApp.close();
  });
});
