/**
 * Tests for POST /internal/code/pubsub/pr-triage
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../../server.js';
import { resetServices, setServices, getServices } from '../../../services.js';
import { createFakeFirestore, resetFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import type { Logger } from 'pino';
import { err } from '@intexuraos/common-core';
import { createFirestoreGitHubPREventsRepository } from '../../../infra/firestore/gitHubPREventsRepository.js';
import { mockWorkerHealthProbe, mockUserServiceClient } from '../../helpers/mockServices.js';
import type { PRTriageEvent } from '@intexuraos/pr-triage-pubsub-client';
import type { UnifiedEvaluator } from '../../../domain/services/unifiedEvaluator.js';
import type { GitHubPREventRepository } from '../../../domain/repositories/gitHubPREventRepository.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import nock from 'nock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushEnvelope(
  event: Partial<PRTriageEvent>,
  messageId = 'msg-1',
): Record<string, unknown> {
  const payload: PRTriageEvent = {
    type: 'code.pr.triage.requested',
    eventId: 'will-override',
    repository: 'pbuchman/intexuraos',
    pullRequestNumber: 9999,
    correlationId: 'corr-1',
    timestamp: new Date().toISOString(),
    ...event,
  };
  return {
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString('base64'),
      messageId,
      publishTime: new Date().toISOString(),
    },
    subscription: 'projects/p/subscriptions/intexuraos-pr-triage-dev-push',
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('POST /internal/code/pubsub/pr-triage', () => {
  let fakeFirestore: ReturnType<typeof createFakeFirestore>;
  let logger: Logger;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let gitHubPREventRepo: GitHubPREventRepository;
  let evaluateMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    nock('http://linear-agent:8086').persist().post(/\/.*/).reply(200, { success: true });

    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as Logger;

    gitHubPREventRepo = createFirestoreGitHubPREventsRepository({ logger });
    evaluateMock = vi.fn().mockResolvedValue(undefined);

    const unifiedEvaluator: UnifiedEvaluator = {
      evaluate: evaluateMock as UnifiedEvaluator['evaluate'],
    };

    setServices({
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo: {} as never,
      logChunkRepo: {} as never,
      logLineRepo: {} as never,
      taskDispatcher: {} as never,
      whatsappNotifier: {} as never,
      linearAgentClient: {} as never,
      linearIssueService: {} as never,
      metricsClient: {} as never,
      processHeartbeat: {} as never,
      detectZombieTasks: {} as never,
      archiveStaleGroups: {} as never,
      autoArchiveMergedTasks: {} as never,
      workerSettingsRepo: {} as never,
      workerHealthProbe: mockWorkerHealthProbe,
      gitHubPREventRepo,
      gitHubPRSummaryRepo: {} as never,
      turnMetricsRepo: {} as never,
      userServiceClient: mockUserServiceClient,
      gitHubPRClient: {} as never,
      webhookRules: {} as never,
      dispatchService: {} as never,
      resolveToolCallingClient: (() => { throw new Error('unused'); }) as never,
      eventDecisionRepo: {} as never,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator,
      automationLog: {} as never,
      taskEnqueueService: {} as never,
      mergeConflictDetector: {
        detectOnPush: vi.fn().mockResolvedValue(undefined),
        reconcile: vi.fn().mockResolvedValue({ processed: 0 }),
      },
      mergeQueueWatchRepo: {} as never,
      prTriagePublisher: {} as never,
    } as never);

    server = await buildServer();
  });

  afterEach(() => {
    resetServices();
    resetFirestore();
    nock.cleanAll();
  });

  async function saveEvent(deliveryId: string): Promise<string> {
    const savedResult = await gitHubPREventRepo.save({
      githubEventId: 12345,
      deliveryId,
      repository: 'pbuchman/intexuraos',
      repositoryId: 999,
      pullRequestNumber: 9999,
      pullRequestId: 111,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'user1',
      senderId: 42,
      senderType: 'User',
      prAuthorLogin: 'author1',
      title: 'Test PR',
      body: 'Test body',
      state: 'open',
      isDraft: false,
      baseBranch: 'development',
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });
    if (!savedResult.ok) throw new Error('save failed');
    return savedResult.value.id;
  }

  // -------------------------------------------------------------------------
  // 1. Happy path
  // -------------------------------------------------------------------------
  it('should return 200 and call evaluate when event exists in Firestore', async () => {
    // Save a real event into fakeFirestore first
    const savedResult = await gitHubPREventRepo.save({
      githubEventId: 12345,
      deliveryId: 'delivery-1',
      repository: 'pbuchman/intexuraos',
      repositoryId: 999,
      pullRequestNumber: 9999,
      pullRequestId: 111,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'user1',
      senderId: 42,
      senderType: 'User',
      prAuthorLogin: 'author1',
      title: 'Test PR',
      body: 'Test body',
      state: 'open',
      isDraft: false,
      baseBranch: 'main',
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });
    expect(savedResult.ok).toBe(true);
    if (!savedResult.ok) throw new Error('save failed');
    const eventId = savedResult.value.id; // @allow-result-access -- narrowed by savedResult.ok

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }),
    });

    expect(response.statusCode).toBe(200);
    expect(evaluateMock).toHaveBeenCalledOnce();
    const calledWith = evaluateMock.mock.calls[0]?.[0] as GitHubPREvent;
    expect(calledWith.id).toBe(eventId);
  });

  it('lets only one parallel delivery evaluate and returns retryable 5xx to the active foreign lease', async () => {
    const eventId = await saveEvent('delivery-parallel');
    let releaseEvaluation: (() => void) | undefined;
    const evaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve;
    });
    evaluateMock.mockImplementationOnce(async () => await evaluationGate);

    const firstRequest = server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }, 'msg-owner'),
    });
    await vi.waitFor(() => expect(evaluateMock).toHaveBeenCalledOnce());

    const competingResponse = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }, 'msg-competitor'),
    });

    expect(competingResponse.statusCode).toBe(500);
    expect(evaluateMock).toHaveBeenCalledOnce();
    releaseEvaluation?.();
    const ownerResponse = await firstRequest;
    expect(ownerResponse.statusCode).toBe(200);
  });

  it('acks a completed redelivery without evaluating twice', async () => {
    const eventId = await saveEvent('delivery-completed-redelivery');

    const firstResponse = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }, 'msg-first'),
    });
    const redeliveryResponse = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }, 'msg-redelivery'),
    });

    expect(firstResponse.statusCode).toBe(200);
    expect(redeliveryResponse.statusCode).toBe(200);
    expect(evaluateMock).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 2. Unauthorized
  // -------------------------------------------------------------------------
  it('should return 401 when no auth header', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId: 'some-event' }),
    });

    expect(response.statusCode).toBe(401);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. Not found (eventId does not exist)
  // -------------------------------------------------------------------------
  it('should return 200 and NOT call evaluate when event not found in Firestore', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId: 'nonexistent-event-id' }),
    });

    expect(response.statusCode).toBe(200);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. Firestore error
  // -------------------------------------------------------------------------
  it('should return 500 when acquireTriage returns a Firestore error', async () => {
    const services = getServices();
    const originalRepo = services.gitHubPREventRepo;
    services.gitHubPREventRepo = {
      ...originalRepo,
      acquireTriage: vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'Simulated Firestore failure',
      })),
    };

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId: 'any-event-id' }),
    });

    expect(response.statusCode).toBe(500);
    expect(evaluateMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. Evaluator throws
  // -------------------------------------------------------------------------
  it('should return 500 when unifiedEvaluator.evaluate throws', async () => {
    const savedResult = await gitHubPREventRepo.save({
      githubEventId: 99999,
      deliveryId: 'delivery-evaluator-throw',
      repository: 'pbuchman/intexuraos',
      repositoryId: 999,
      pullRequestNumber: 9999,
      pullRequestId: 111,
      eventType: 'pull_request',
      action: 'opened',
      senderLogin: 'user1',
      senderId: 42,
      senderType: 'User',
      prAuthorLogin: null,
      title: 'Throw PR',
      body: null,
      state: 'open',
      isDraft: null,
      baseBranch: null,
      mergedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      payload: {},
    });
    expect(savedResult.ok).toBe(true);
    if (!savedResult.ok) throw new Error('save failed');
    const eventId = savedResult.value.id; // @allow-result-access -- narrowed by savedResult.ok

    evaluateMock.mockRejectedValueOnce(new Error('Evaluator exploded'));

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }),
    });

    expect(response.statusCode).toBe(500);

    const retryResponse = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }, 'msg-evaluator-retry'),
    });
    expect(retryResponse.statusCode).toBe(200);
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when a successful evaluation cannot complete its lease', async () => {
    const eventId = await saveEvent('delivery-completion-error');
    const services = getServices();
    services.gitHubPREventRepo = {
      ...services.gitHubPREventRepo,
      completeTriage: vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'completion unavailable',
      })),
    };

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }, 'msg-completion-error'),
    });

    expect(response.statusCode).toBe(500);
    expect(evaluateMock).toHaveBeenCalledOnce();
  });

  it('keeps evaluator failure retryable when releasing the lease also fails', async () => {
    const eventId = await saveEvent('delivery-failure-release-error');
    evaluateMock.mockRejectedValueOnce(new Error('Evaluator exploded'));
    const services = getServices();
    services.gitHubPREventRepo = {
      ...services.gitHubPREventRepo,
      failTriage: vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'release unavailable',
      })),
    };

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: pushEnvelope({ eventId }, 'msg-release-error'),
    });

    expect(response.statusCode).toBe(500);
    expect(evaluateMock).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 6. Decode failure (malformed base64 payload)
  // -------------------------------------------------------------------------
  it('should return 200 and NOT call evaluate when message data is not valid JSON', async () => {
    const badEnvelope = {
      message: {
        data: Buffer.from('NOT VALID JSON {{{').toString('base64'),
        messageId: 'msg-bad',
        publishTime: new Date().toISOString(),
      },
      subscription: 'projects/p/subscriptions/intexuraos-pr-triage-dev-push',
    };

    const response = await server.inject({
      method: 'POST',
      url: '/internal/code/pubsub/pr-triage',
      headers: { from: 'noreply@google.com', 'content-type': 'application/json' },
      payload: badEnvelope,
    });

    expect(response.statusCode).toBe(200);
    expect(evaluateMock).not.toHaveBeenCalled();
  });
});
