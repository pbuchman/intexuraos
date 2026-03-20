/**
 * Integration tests for PR automation log event flows.
 *
 * Wires a REAL createUnifiedEvaluator() with steerable mock deps,
 * sends HTTP webhooks via app.inject(), and asserts the correct
 * sequence of automationLog.record() calls across the full
 * webhook → evaluator → automation-log path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { ok, err, type Logger as CoreLogger, type Result } from '@intexuraos/common-core';
import type { FastifyInstance } from 'fastify';

vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import * as jose from 'jose';
import { buildServer } from '../../../server.js';
import { setServices, resetServices, type ServiceContainer } from '../../../services.js';
import { createFakeFirestore, setFirestore } from '@intexuraos/infra-firestore';
import type { Firestore } from '@google-cloud/firestore';
import pino from 'pino';
import type { Logger } from 'pino';
import type { GitHubPREventRepository } from '../../../domain/repositories/gitHubPREventRepository.js';
import type { GitHubPRSummaryRepository } from '../../../domain/repositories/gitHubPRSummaryRepository.js';
import type { GitHubWebhookAuditEventRepository } from '../../../domain/repositories/gitHubWebhookAuditEventRepository.js';
import type { GitHubEventLogEntryRepository } from '../../../domain/repositories/gitHubEventLogEntryRepository.js';
import type { EventDecisionRepository } from '../../../domain/repositories/eventDecisionRepository.js';
import {
  ProtectedBaseBranchRule,
  ActionableEventRule,
  SenderWhitelistRule,
  SkipPrefixRule,
  createWebhookRulesService,
} from '../../../domain/services/gitHubWebhookRules.js';
import { ALLOWED_BOTS, type GitHubWebhookBody } from '../../../routes/webhooks/github.js';
import { createUnifiedEvaluator, type UnifiedEvaluatorDeps } from '../../../domain/services/unifiedEvaluator.js';
import type { AutomationLog, AutomationEvent, PRRef } from '../../../domain/ports/automationLog.js';
import type { WebhookDispatchService } from '../../../domain/services/gitHubDispatchService.js';
import type { GitHubAgentEvalResult, GitHubAgentError } from '../../../domain/usecases/githubAgent.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import type { CreateReviewTaskResult, CreateReviewTaskError, CreateReviewTaskRequest } from '../../../domain/usecases/createReviewTask.js';
import { waitForDetachedAsync } from '../../helpers/waitForDetachedAsync.js';

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

describe('Automation log integration flows', () => {
  let app: FastifyInstance;
  const testSecret = 'test-webhook-secret';

  // Repos
  let mockEventRepo: GitHubPREventRepository;
  let mockSummaryRepo: GitHubPRSummaryRepository;
  let mockAuditRepo: GitHubWebhookAuditEventRepository;
  let mockEventLogEntryRepo: GitHubEventLogEntryRepository;
  let mockEventDecisionRepo: EventDecisionRepository;

  // Steerable evaluator deps
  let mockAutomationLog: { record: ReturnType<typeof vi.fn> };
  let mockDispatchService: { dispatch: ReturnType<typeof vi.fn> };
  let mockEvaluateEvent: ReturnType<typeof vi.fn<(event: GitHubPREvent) => Promise<Result<GitHubAgentEvalResult, GitHubAgentError>>>>;
  let mockCreateReviewTask: ReturnType<typeof vi.fn<(logger: CoreLogger, request: CreateReviewTaskRequest) => Promise<Result<CreateReviewTaskResult, CreateReviewTaskError>>>>;

  beforeEach(async () => {
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] = testSecret;
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    const fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    const logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    // --- Repo mocks ---
    mockEventRepo = {
      save: vi.fn().mockImplementation(async (input) => ok({
        id: 'test-event-id',
        auditEventId: 'audit-1',
        githubEventId: input.githubEventId ?? 123,
        deliveryId: input.deliveryId ?? null,
        repository: input.repository ?? 'intexuraos/intexuraos',
        repositoryId: input.repositoryId ?? 456,
        pullRequestNumber: input.pullRequestNumber ?? 42,
        pullRequestId: input.pullRequestId ?? 101,
        eventType: input.eventType ?? 'pull_request',
        action: input.action ?? 'opened',
        senderLogin: input.senderLogin ?? 'testuser',
        senderId: input.senderId ?? 999,
        senderType: input.senderType ?? 'User',
        prAuthorLogin: input.prAuthorLogin ?? null,
        title: input.title ?? 'Test PR',
        body: input.body ?? 'Test description',
        state: input.state ?? 'open',
        baseBranch: input.baseBranch ?? null,
        mergedAt: input.mergedAt ?? null,
        createdAt: input.createdAt ?? new Date(),
        processedAt: new Date(),
        payload: input.payload ?? {},
      })),
      findByPullRequest: vi.fn().mockResolvedValue(ok([])),
      findByRepository: vi.fn().mockResolvedValue(ok([])),
      findAll: vi.fn().mockResolvedValue(ok([])),
      findReviewComments: vi.fn().mockResolvedValue(ok([])),
    };

    mockSummaryRepo = {
      upsert: vi.fn().mockResolvedValue(ok(undefined)),
      findRecentlyActive: vi.fn().mockResolvedValue(ok([])),
      findByPullRequest: vi.fn().mockResolvedValue(ok(null)),
      findOpenByBaseBranch: vi.fn().mockResolvedValue(ok([])),
      findAllOpen: vi.fn().mockResolvedValue(ok([])),
    };

    mockAuditRepo = {
      save: vi.fn().mockImplementation(async (input) => ok({ id: 'audit-1', ...input })),
      updateNormalizationStatus: vi.fn().mockImplementation(async ({ id, normalizationStatus }) => ok({
        id,
        deliveryId: 'delivery-1',
        githubEventName: 'pull_request',
        eventType: 'pull_request',
        action: 'opened',
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 101,
        senderLogin: 'testuser',
        senderId: 999,
        senderType: 'User',
        authPassedAt: new Date('2026-03-15T10:00:00.000Z'),
        receivedAt: new Date('2026-03-15T10:00:00.000Z'),
        normalizationStatus,
        payload: {},
      })),
      findByIds: vi.fn().mockResolvedValue(ok([])),
    };

    mockEventLogEntryRepo = {
      createPending: vi.fn().mockImplementation(async (input) => ok({ ...input, decisionId: null })),
      complete: vi.fn().mockImplementation(async (input) => ok({
        id: input.id,
        githubEventName: 'pull_request',
        eventType: 'pull_request',
        action: 'opened',
        repository: 'intexuraos/intexuraos',
        pullRequestNumber: 42,
        authPassedAt: new Date('2026-03-15T10:00:00.000Z'),
        updatedAt: input.updatedAt,
        decisionState: input.decisionState,
        decisionOutcome: input.decisionOutcome,
        decisionId: input.decisionId,
        rowVersion: input.rowVersion,
      })),
      listRecent: vi.fn(),
      findByIds: vi.fn().mockResolvedValue(ok([])),
    };

    mockEventDecisionRepo = {
      save: vi.fn().mockImplementation(async (input) => ok({
        id: `ed_${input.eventId}`,
        ...input,
        createdAt: new Date('2026-03-15T10:00:01.000Z'),
      })),
      findByEventIds: vi.fn().mockResolvedValue(ok([])),
    };

    // --- Steerable evaluator dependencies ---
    mockAutomationLog = { record: vi.fn().mockResolvedValue(undefined) };
    mockDispatchService = { dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: false }) };
    mockEvaluateEvent = vi.fn<(event: GitHubPREvent) => Promise<Result<GitHubAgentEvalResult, GitHubAgentError>>>();
    mockCreateReviewTask = vi.fn<(logger: CoreLogger, request: CreateReviewTaskRequest) => Promise<Result<CreateReviewTaskResult, CreateReviewTaskError>>>()
      .mockResolvedValue(ok({ status: 'created' as const, taskId: 'task-review-1', workerType: 'qwen' as const }));

    // Rules include ProtectedBaseBranchRule to test hard-rule skip flows
    const webhookRules = createWebhookRulesService([
      new ActionableEventRule(ALLOWED_BOTS),
      new ProtectedBaseBranchRule(),
      new SenderWhitelistRule(ALLOWED_BOTS),
      new SkipPrefixRule(['@claude', '@codex', '@ignore']),
    ]);

    const evaluatorDeps: UnifiedEvaluatorDeps = {
      webhookRules,
      dispatchService: mockDispatchService as unknown as WebhookDispatchService,
      eventDecisionRepo: mockEventDecisionRepo,
      gitHubEventLogEntryRepo: mockEventLogEntryRepo,
      evaluateEvent: mockEvaluateEvent,
      createReviewTask: mockCreateReviewTask,
      automationLog: mockAutomationLog as AutomationLog,
      allowedBots: ALLOWED_BOTS,
    };

    const unifiedEvaluator = createUnifiedEvaluator(evaluatorDeps);

    const mockServices: ServiceContainer = {
      firestore: fakeFirestore as unknown as Firestore,
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
      metricsClient: {} as never,
      workerSettingsRepo: {} as never,
      workerHealthProbe: {} as never,
      gitHubPREventRepo: mockEventRepo,
      gitHubPRSummaryRepo: mockSummaryRepo,
      gitHubWebhookAuditEventRepo: mockAuditRepo,
      gitHubEventLogEntryRepo: mockEventLogEntryRepo,
      turnMetricsRepo: {} as never,
      userServiceClient: {
        getApiKeys: vi.fn(),
        getLlmClient: vi.fn(),
        reportLlmSuccess: vi.fn(),
        resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'user-1' })),
        getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'oauth-token-123', email: 'test@test.com' })),
      } as never,
      gitHubPRClient: {} as never,
      webhookRules,
      dispatchService: mockDispatchService as unknown as WebhookDispatchService,
      toolCallingClient: undefined,
      eventDecisionRepo: mockEventDecisionRepo,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator,
      automationLog: mockAutomationLog as AutomationLog,
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
    };

    setServices(mockServices);
    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
    resetServices();
    delete process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'];
    delete process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'];
    delete process.env['INTEXURAOS_AUTH_AUDIENCE'];
    delete process.env['INTEXURAOS_AUTH_ISSUER'];
    delete process.env['INTEXURAOS_AUTH_JWKS_URL'];
  });

  // --- Helpers ---

  function signPayload(payload: unknown): { payload: string; signature: string } {
    const payloadStr = JSON.stringify(payload);
    const payloadBuffer = Buffer.from(payloadStr, 'utf-8');
    const hmac = createHmac('sha256', testSecret);
    hmac.update(payloadBuffer);
    const signature = `sha256=${hmac.digest('hex')}`;
    return { payload: payloadStr, signature };
  }

  function createPullRequestPayload(overrides: Partial<GitHubWebhookBody> = {}): GitHubWebhookBody {
    return {
      action: 'opened',
      repository: {
        id: 456,
        name: 'intexuraos',
        full_name: 'intexuraos/intexuraos',
        owner: { login: 'intexuraos', id: 789 },
      },
      pull_request: {
        id: 101,
        number: 42,
        title: 'Test PR',
        body: 'Test description',
        state: 'open',
        merged_at: null,
      },
      sender: { login: 'testuser', id: 999, type: 'User' },
      ...overrides,
    };
  }

  function createIssueCommentPayload(commentBody: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      action: 'created',
      repository: {
        id: 456,
        name: 'intexuraos',
        full_name: 'intexuraos/intexuraos',
        owner: { login: 'intexuraos', id: 789 },
      },
      issue: {
        id: 101,
        number: 42,
        title: 'Test PR',
        state: 'open',
        pull_request: { url: 'https://api.github.com/repos/intexuraos/intexuraos/pulls/42' },
      },
      comment: { id: 5001, body: commentBody },
      sender: { login: 'testuser', id: 999, type: 'User' },
      ...overrides,
    };
  }

  async function sendWebhook(
    eventType: string,
    payload: unknown,
  ): Promise<{ statusCode: number; body: string }> {
    const { payload: payloadStr, signature } = signPayload(payload);
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/github',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
        'x-github-event': eventType,
        'x-github-delivery': 'delivery-test-123',
      },
      body: payloadStr,
    });
    return { statusCode: response.statusCode, body: response.body };
  }

  function getRecordedEvents(): { prRef: PRRef; event: AutomationEvent; userId: string | undefined }[] {
    return (mockAutomationLog.record.mock.calls as [PRRef, AutomationEvent, string | undefined][]).map(
      (call) => ({
        prRef: call[0],
        event: call[1],
        userId: call[2],
      }),
    );
  }

  // --- Flow 4: Hard rules skip ---

  describe('hard rules skip (flow 4)', () => {
    it('records webhook_received then skipped(hard_rules, PROTECTED_BASE_BRANCH)', async () => {
      // ProtectedBaseBranchRule skips when baseBranch is 'main'
      const prPayload = createPullRequestPayload();
      // The event repo returns the saved event with baseBranch='main'
      vi.mocked(mockEventRepo.save).mockResolvedValueOnce(ok({
        id: 'evt-hard-skip',
        auditEventId: 'audit-1',
        githubEventId: 123,
        deliveryId: 'delivery-test-123',
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 101,
        eventType: 'pull_request' as const,
        action: 'opened' as const,
        senderLogin: 'testuser',
        senderId: 999,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'Test description',
        state: 'open',
        baseBranch: 'main',
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: {},
      }));

      const { statusCode } = await sendWebhook('pull_request', prPayload);
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().length >= 2);

      const events = getRecordedEvents();
      // First call: webhook_received from the route handler
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]?.event.type).toBe('webhook_received');

      // Second call: skipped from the evaluator
      const skippedEvent = events.find((e) => e.event.type === 'skipped');
      expect(skippedEvent).toBeDefined();
      expect(skippedEvent?.event).toMatchObject({
        type: 'skipped',
        decidedBy: 'hard_rules',
        reason: 'PROTECTED_BASE_BRANCH',
      });
    });
  });

  // --- Flow 5: LLM skip ---

  describe('LLM triage skip (flow 5)', () => {
    it('records webhook_received then skipped(llm_triage)', async () => {
      mockEvaluateEvent.mockResolvedValueOnce(ok({
        triage: { action: 'skip', reason: 'No review needed for docs-only change' },
        usage: { costUsd: 0.001, toolCalls: [] },
        reasoning: 'Only documentation changes detected',
      }));

      const { statusCode } = await sendWebhook('pull_request', createPullRequestPayload());
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().length >= 2);

      const events = getRecordedEvents();
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]?.event.type).toBe('webhook_received');

      const skippedEvent = events.find((e) => e.event.type === 'skipped');
      expect(skippedEvent).toBeDefined();
      expect(skippedEvent?.event).toMatchObject({
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: 'No review needed for docs-only change',
      });
    });
  });

  // --- Flow 6: LLM fail on PR event → triage_failed(skip) ---

  describe('LLM fail on pull_request event (flow 6)', () => {
    it('records webhook_received then triage_failed with fallback skip', async () => {
      // First call fails, triggering retry for pull_request events
      mockEvaluateEvent.mockResolvedValueOnce(
        err({ code: 'LLM_FAILED' as const, message: 'Model unavailable' }),
      );
      // Retry also fails → enters handleFallback path
      mockEvaluateEvent.mockResolvedValueOnce(
        err({ code: 'LLM_FAILED' as const, message: 'Model unavailable' }),
      );


      const { statusCode } = await sendWebhook('pull_request', createPullRequestPayload());
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().length >= 2);

      const events = getRecordedEvents();
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0]?.event.type).toBe('webhook_received');

      const failedEvent = events.find((e) => e.event.type === 'triage_failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.event).toMatchObject({
        type: 'triage_failed',
        error: 'Model unavailable',
        fallbackAction: 'skip',
      });
    });
  });

  // --- Flow 7: LLM fail on @review comment → triage_failed(skip) ---
  // Note: issue_comment events don't have top-level pull_request in the payload,
  // so webhook_received is NOT recorded by the route handler (pullRequestNumber is null).

  describe('LLM fail on @review comment (flow 7)', () => {
    it('records triage_failed with fallback skip for @review', async () => {
      mockEvaluateEvent.mockResolvedValueOnce(
        err({ code: 'LLM_FAILED' as const, message: 'Rate limited' }),
      );

      const { statusCode } = await sendWebhook(
        'issue_comment',
        createIssueCommentPayload('@review please check this'),
      );
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().some((e) => e.event.type === 'triage_failed'));

      const events = getRecordedEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);

      const failedEvent = events.find((e) => e.event.type === 'triage_failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.event).toMatchObject({
        type: 'triage_failed',
        error: 'Rate limited',
        fallbackAction: 'skip',
      });
    });
  });

  // --- Flow 8: LLM fail on regular comment → triage_failed(dispatch) ---

  describe('LLM fail on regular comment (flow 8)', () => {
    it('records triage_failed with fallback dispatch', async () => {
      mockEvaluateEvent.mockResolvedValueOnce(
        err({ code: 'LLM_FAILED' as const, message: 'Timeout' }),
      );

      const { statusCode } = await sendWebhook(
        'issue_comment',
        createIssueCommentPayload('fix the lint errors'),
      );
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().some((e) => e.event.type === 'triage_failed'));

      const events = getRecordedEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);

      const failedEvent = events.find((e) => e.event.type === 'triage_failed');
      expect(failedEvent).toBeDefined();
      expect(failedEvent?.event).toMatchObject({
        type: 'triage_failed',
        error: 'Timeout',
        fallbackAction: 'dispatch',
      });

      // Verify dispatch was actually called for the fallback
      expect(mockDispatchService.dispatch).toHaveBeenCalled();
    });
  });

  // --- Flow 12: Dispatch success ---

  describe('dispatch success (flow 12)', () => {
    it('records triage_dispatch and dispatch is called successfully', async () => {
      mockEvaluateEvent.mockResolvedValueOnce(ok({
        triage: { action: 'dispatch', template: 'pr_comment' as const },
        usage: { costUsd: 0.002, toolCalls: [{ tool: 'read_file', args: { path: 'src/index.ts' } }] },
        reasoning: 'User is requesting a code change',
      }));
      mockDispatchService.dispatch.mockResolvedValueOnce({ success: true, dispatched: true });

      const { statusCode } = await sendWebhook(
        'issue_comment',
        createIssueCommentPayload('please fix the typo in README'),
      );
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().some((e) => e.event.type === 'triage_dispatch'));

      const events = getRecordedEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);

      const triageDispatch = events.find((e) => e.event.type === 'triage_dispatch');
      expect(triageDispatch).toBeDefined();
      expect(triageDispatch?.event).toMatchObject({
        type: 'triage_dispatch',
        cost: 0.002,
        reasoning: 'User is requesting a code change',
      });

      expect(mockDispatchService.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: { action: 'dispatch', reason: 'LLM_DISPATCH' },
        }),
      );
    });
  });

  // --- Flow 13: Dispatch fail ---

  describe('dispatch fail (flow 13)', () => {
    it('records triage_dispatch even when dispatch fails', async () => {
      mockEvaluateEvent.mockResolvedValueOnce(ok({
        triage: { action: 'dispatch', template: 'pr_comment' as const },
        usage: { costUsd: 0.003, toolCalls: [] },
        reasoning: 'Dispatch requested',
      }));
      mockDispatchService.dispatch.mockResolvedValueOnce({ success: false, dispatched: false, error: 'No worker available' });

      const { statusCode } = await sendWebhook(
        'issue_comment',
        createIssueCommentPayload('update the config'),
      );
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().some((e) => e.event.type === 'triage_dispatch'));

      const events = getRecordedEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);

      // triage_dispatch is recorded even on dispatch failure
      const triageDispatch = events.find((e) => e.event.type === 'triage_dispatch');
      expect(triageDispatch).toBeDefined();
      expect(triageDispatch?.event).toMatchObject({
        type: 'triage_dispatch',
        cost: 0.003,
      });

      expect(mockDispatchService.dispatch).toHaveBeenCalled();
    });
  });

  // --- Flows 14+15: Review dispatched ---

  describe('review dispatched (flows 14+15)', () => {
    it('records triage_dispatch with review types', async () => {
      mockEvaluateEvent.mockResolvedValueOnce(ok({
        triage: {
          action: 'request_review',
          reviewTypes: ['code_review', 'architecture'],
          workerType: 'opus' as const,
        },
        usage: { costUsd: 0.005, toolCalls: [{ tool: 'list_files', args: {} }] },
        reasoning: 'PR introduces new architecture patterns requiring review',
      }));
      mockCreateReviewTask.mockResolvedValueOnce(ok({
        status: 'created' as const,
        taskId: 'task-review-42',
        workerType: 'opus' as const,
      }));

      const { statusCode } = await sendWebhook(
        'issue_comment',
        createIssueCommentPayload('@review architecture'),
      );
      expect(statusCode).toBe(200);

      await waitForDetachedAsync(() => getRecordedEvents().some((e) => e.event.type === 'triage_dispatch'));

      const events = getRecordedEvents();
      expect(events.length).toBeGreaterThanOrEqual(1);

      const triageDispatch = events.find((e) => e.event.type === 'triage_dispatch');
      expect(triageDispatch).toBeDefined();
      expect(triageDispatch?.event).toMatchObject({
        type: 'triage_dispatch',
        reviewTypes: ['code_review', 'architecture'],
        workerType: 'opus',
        cost: 0.005,
        reasoning: 'PR introduces new architecture patterns requiring review',
      });

      // createReviewTask was called
      expect(mockCreateReviewTask).toHaveBeenCalledWith(
        expect.anything(), // logger
        expect.objectContaining({
          repository: 'intexuraos/intexuraos',
          prNumber: 42,
          reviewTypes: ['code_review', 'architecture'],
        }),
      );
    });
  });
});
