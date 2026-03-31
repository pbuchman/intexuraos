/**
 * Tests for GitHub webhook route
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes, createHmac } from 'node:crypto';
import { ok, err } from '@intexuraos/common-core';
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
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import type { GitHubPRSummaryRepository } from '../../../domain/repositories/gitHubPRSummaryRepository.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import { ActionableEventRule, SenderWhitelistRule, SkipPrefixRule, createWebhookRulesService } from '../../../domain/services/gitHubWebhookRules.js';
import { ALLOWED_BOTS, type GitHubWebhookBody } from '../../../routes/webhooks/github.js';
import type { GitHubWebhookAuditEventRepository } from '../../../domain/repositories/gitHubWebhookAuditEventRepository.js';
import type { GitHubEventLogEntryRepository } from '../../../domain/repositories/gitHubEventLogEntryRepository.js';
import type { EventDecisionRepository } from '../../../domain/repositories/eventDecisionRepository.js';
import { waitForDetachedAsync, waitForSettlement } from '../../helpers/waitForDetachedAsync.js';

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

describe('POST /webhooks/github', () => {
  let app: FastifyInstance;
  let testSecret: string;
  let mockEventRepo: GitHubPREventRepository;
  let mockSummaryRepo: GitHubPRSummaryRepository;
  let mockAuditRepo: GitHubWebhookAuditEventRepository;
  let mockEventLogEntryRepo: GitHubEventLogEntryRepository;
  let mockEventDecisionRepo: EventDecisionRepository;
  let mockServices: ServiceContainer;

  beforeEach(async () => {
    testSecret = 'test-webhook-secret';

    // Mock JWT verification
    mockedJwtVerify.mockResolvedValue({
      payload: { sub: 'test-user-id', email: 'test@example.com' },
      protectedHeader: new Uint8Array(),
    } as never);

    // Set required env vars
    process.env['INTEXURAOS_GITHUB_WEBHOOK_SECRET'] = testSecret;
    process.env['INTEXURAOS_INTERNAL_AUTH_TOKEN'] = 'test-internal-token';
    process.env['INTEXURAOS_AUTH_AUDIENCE'] = 'https://api.intexuraos.cloud';
    process.env['INTEXURAOS_AUTH_ISSUER'] = 'https://intexuraos.eu.auth0.com/';
    process.env['INTEXURAOS_AUTH_JWKS_URL'] = 'https://intexuraos.eu.auth0.com/.well-known/jwks.json';

    // Setup fake Firestore
    const fakeFirestore = createFakeFirestore();
    setFirestore(fakeFirestore as unknown as Firestore);
    const logger = pino({ name: 'test', level: 'silent' }) as unknown as Logger;

    // Create mock repo that returns a valid event object with an id
    mockEventRepo = {
      save: (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 123,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 789,
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
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: {},
      })),
      findByPullRequest: (): Promise<ReturnType<typeof ok<GitHubPREvent[]>>> => Promise.resolve(ok([])),
      findByRepository: (): Promise<ReturnType<typeof ok<GitHubPREvent[]>>> => Promise.resolve(ok([])),
      findAll: (): Promise<ReturnType<typeof ok<GitHubPREvent[]>>> => Promise.resolve(ok([])),
      findReviewComments: (): Promise<ReturnType<typeof ok<GitHubPREvent[]>>> => Promise.resolve(ok([])),
    };

    // Create mock codeTaskRepo for processPRCommentForTask
    const mockCodeTaskRepo: CodeTaskRepository = {
      create: vi.fn().mockResolvedValue(ok({ id: 'task-123' })),
      findById: vi.fn().mockResolvedValue(ok(null)),
      findByIdForUser: vi.fn().mockResolvedValue(ok(null)),
      update: vi.fn().mockResolvedValue(ok(undefined)),
      list: vi.fn().mockResolvedValue(ok([])),
      hasActiveTaskForLinearIssue: vi.fn().mockResolvedValue(ok(false)),
      findZombieTasks: vi.fn().mockResolvedValue(ok([])),
      countByUserToday: vi.fn().mockResolvedValue(ok(0)),
      findArchivableTasks: vi.fn().mockResolvedValue(ok([])),
      archiveTaskLogs: vi.fn().mockResolvedValue(ok(undefined)),
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
      hasDispatchedOrRunningForPR: vi.fn().mockResolvedValue(ok({ hasActive: false })),
      deleteTask: vi.fn().mockResolvedValue(ok(undefined)),
      listQueuedByAge: vi.fn().mockResolvedValue(ok([])),
      listQueued: vi.fn().mockResolvedValue(ok([])),
      countQueued: vi.fn().mockResolvedValue(ok(0)),
      findRecentTasksByLinearIssue: vi.fn().mockResolvedValue(ok([])),
      findPlannedTaskByLinearIssue: vi.fn().mockResolvedValue(ok(null)),
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findRecentRemediationForPR: vi.fn().mockResolvedValue(ok(null)),
      findPreservedPullRequestTask: vi.fn().mockResolvedValue(ok(null)),
      listAllNonArchived: vi.fn().mockResolvedValue(ok([])),
      listAllNonArchivedGlobal: vi.fn().mockResolvedValue(ok([])),
    };

    // Create mock PR summary repo
    mockSummaryRepo = {
      upsert: vi.fn().mockResolvedValue(ok(undefined)),
      findRecentlyActive: vi.fn().mockResolvedValue(ok([])),
      findByPullRequest: vi.fn().mockResolvedValue(ok(null)),
      findOpenByBaseBranch: vi.fn().mockResolvedValue(ok([])),
      findOpenByRepository: vi.fn().mockResolvedValue(ok([])),
      findAllOpen: vi.fn().mockResolvedValue(ok([])),
    };

    mockAuditRepo = {
      save: vi.fn().mockImplementation(async (input) => ok({
        id: 'audit-1',
        ...input,
      })),
      updateNormalizationStatus: vi.fn().mockImplementation(async ({ id, normalizationStatus }) => ok({
        id,
        deliveryId: 'delivery-1',
        githubEventName: 'pull_request',
        eventType: 'pull_request',
        action: 'opened',
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 123,
        pullRequestId: 101,
        senderLogin: 'testuser',
        senderId: 999,
        senderType: 'User',
        authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
        receivedAt: new Date('2026-03-12T10:00:00.000Z'),
        normalizationStatus,
        payload: {},
      })),
      findByIds: vi.fn().mockResolvedValue(ok([])),
    };

    mockEventLogEntryRepo = {
      createPending: vi.fn().mockImplementation(async (input) => ok({
        ...input,
        decisionId: null,
      })),
      complete: vi.fn().mockImplementation(async (input) => ok({
        id: input.id,
        githubEventName: 'ping',
        eventType: 'ping',
        action: null,
        repository: null,
        pullRequestNumber: null,
        authPassedAt: new Date('2026-03-12T10:00:00.000Z'),
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
        createdAt: new Date('2026-03-12T10:00:01.000Z'),
      })),
      findByEventIds: vi.fn().mockResolvedValue(ok([])),
    };

    // Setup services with all required fields
    mockServices = {
      firestore: fakeFirestore as unknown as Firestore,
      logger,
      codeTaskRepo: mockCodeTaskRepo,
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
      webhookRules: createWebhookRulesService([
        new ActionableEventRule(ALLOWED_BOTS),
        new SenderWhitelistRule(ALLOWED_BOTS),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ]),
      dispatchService: { dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: false }) },
      toolCallingClient: undefined,
      eventDecisionRepo: mockEventDecisionRepo,
      dispatchRetryRepo: {} as never,
      unifiedEvaluator: { evaluate: vi.fn().mockResolvedValue(undefined) },
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
      automationLog: { record: vi.fn().mockResolvedValue(undefined) },
      taskEnqueueService: {} as never,
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
        full_name: 'pbuchman/intexuraos',
        owner: {
          login: 'pbuchman',
          id: 789,
        },
      },
      pull_request: {
        id: 101,
        number: 123,
        title: 'Test PR',
        body: 'Test description',
        state: 'open',
        merged_at: null,
      },
      sender: {
        login: 'testuser',
        id: 999,
        type: 'User',
      },
      ...overrides,
    };
  }

  describe('signature verification', () => {
    it('should return 200 OK for valid signature', async () => {
      const { payload, signature } = signPayload({ action: 'opened' });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 401 for missing signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-github-event': 'ping',
        },
        body: '{}',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for invalid signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=wrong',
          'x-github-event': 'ping',
        },
        body: '{}',
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('should return 401 for signature without sha256= prefix', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': randomBytes(32).toString('hex'),
          'x-github-event': 'ping',
        },
        body: '{}',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('audit persistence failures', () => {
    it('returns 500 when the auth-passed audit event cannot be persisted', async () => {
      mockAuditRepo.save = vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
      );

      const { payload, signature } = signPayload({ zen: 'keep it real' });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(mockEventLogEntryRepo.createPending).not.toHaveBeenCalled();
    });
  });

  describe('ping event', () => {
    it('should respond to ping event with pong', async () => {
      const { payload, signature } = signPayload({ zen: 'keep it real' });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('pong');
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          githubEventName: 'ping',
          eventType: 'ping',
        })
      );
      expect(mockEventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'audit-1',
          decidedBy: 'webhook_route',
          decision: 'skip',
          reason: 'ping_event',
        })
      );
      expect(mockEventLogEntryRepo.createPending).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-1',
          decisionState: 'pending',
        })
      );
      expect(mockEventLogEntryRepo.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-1',
          decisionState: 'completed',
          decisionOutcome: 'skip',
          decisionId: 'ed_audit-1',
        })
      );
      expect(mockAuditRepo.updateNormalizationStatus).toHaveBeenCalledWith({
        id: 'audit-1',
        normalizationStatus: 'ignored',
      });
    });
  });

  describe('pull_request event - IntexuraOS repository', () => {
    it('should process pull_request events for intexuraos repositories', async () => {
      const prPayload = {
        action: 'opened',
        number: 123,
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'pbuchman/intexuraos',
          owner: {
            login: 'pbuchman',
            id: 789,
          },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          merged_at: null,
        },
        sender: {
          login: 'testuser',
          id: 999,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('triggers unified evaluator for pull_request events', async () => {
      const { getServices } = await import('../../../services.js');
      const currentServices = getServices();
      const mockEvaluate = vi.mocked(currentServices.unifiedEvaluator.evaluate);

      const prPayload = {
        action: 'opened',
        number: 123,
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: { login: 'intexuraos', id: 789 },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          merged_at: null,
        },
        sender: { login: 'testuser', id: 999, type: 'User' },
      };

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      // Wait for the fire-and-forget evaluate to complete
      await waitForDetachedAsync(() => mockEvaluate.mock.calls.length >= 1);

      // The unified evaluator should have been called
      expect(mockEvaluate).toHaveBeenCalled();
    });

    it('should return 200 but not store events for non-intexuraos repositories', async () => {
      const prPayload = {
        action: 'opened',
        number: 123,
        repository: {
          id: 456,
          name: 'other-repo',
          full_name: 'someone/other-repo',
          owner: {
            login: 'someone',
            id: 789,
          },
        },
        sender: {
          login: 'testuser',
          id: 999,
          type: 'User',
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Out of scope PR',
          body: 'This repo should be ignored after auth passes.',
          state: 'open',
          merged_at: null,
        },
      };

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('ignored');
      expect(mockAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          githubEventName: 'pull_request',
          eventType: 'pull_request',
          repository: 'someone/other-repo',
        })
      );
      expect(mockEventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'audit-1',
          decidedBy: 'webhook_route',
          decision: 'skip',
          reason: 'repository_out_of_scope',
        })
      );
      expect(mockEventLogEntryRepo.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-1',
          decisionOutcome: 'skip',
        })
      );
      expect(mockAuditRepo.updateNormalizationStatus).toHaveBeenCalledWith({
        id: 'audit-1',
        normalizationStatus: 'ignored',
      });
    });
  });

  describe('invalid payload handling', () => {
    it('records a route-level decision for malformed payloads after auth passes', async () => {
      const invalidPayload = {
        action: 'opened',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        // sender and pull_request intentionally omitted so parsing fails
      };

      const { payload, signature } = signPayload(invalidPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'invalid-delivery-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('acknowledged');
      expect(mockEventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'audit-1',
          decidedBy: 'webhook_route',
          decision: 'skip',
          reason: 'invalid_payload',
        })
      );
      expect(mockEventLogEntryRepo.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-1',
          decisionOutcome: 'skip',
        })
      );
      expect(mockAuditRepo.updateNormalizationStatus).toHaveBeenCalledWith({
        id: 'audit-1',
        normalizationStatus: 'invalid',
      });
    });
  });

  describe('unsupported event handling', () => {
    it('records a route-level decision for unsupported auth-passed events', async () => {
      const unsupportedPayload = {
        action: 'queued',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        sender: {
          login: 'octocat',
          id: 1,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(unsupportedPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'workflow_job',
          'x-github-delivery': 'unsupported-delivery-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('acknowledged');
      expect(mockEventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'audit-1',
          decidedBy: 'webhook_route',
          decision: 'skip',
          reason: 'unsupported_event',
          eventType: 'unknown',
          eventAction: 'unknown',
        })
      );
      expect(mockEventLogEntryRepo.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-1',
          decisionOutcome: 'skip',
        })
      );
      expect(mockAuditRepo.updateNormalizationStatus).toHaveBeenCalledWith({
        id: 'audit-1',
        normalizationStatus: 'unsupported',
      });
    });
  });

  describe('pull_request_review event', () => {
    it('should process review events for intexuraos repositories', async () => {
      const reviewPayload = {
        action: 'submitted',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          state: 'open',
        },
        review: {
          id: 456,
          body: 'LGTM',
          state: 'approved',
        },
        sender: {
          login: 'reviewer',
          id: 111,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(reviewPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request_review',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  describe('push event', () => {
    it('should process push events for intexuraos repositories', async () => {
      const pushPayload = {
        ref: 'refs/heads/main',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        sender: {
          login: 'pusher',
          id: 222,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(pushPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('triggers merge-conflict detection from push webhook', async () => {
      const { getServices } = await import('../../../services.js');
      const currentServices = getServices();
      const mockDetectOnPush = vi.fn().mockResolvedValue(undefined);
      currentServices.mergeConflictDetector.detectOnPush = mockDetectOnPush;

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'push-event-id',
        githubEventId: 999,
        deliveryId: 'delivery-123',
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 0,
        pullRequestId: 0,
        eventType: 'push',
        action: null,
        senderLogin: 'pusher',
        senderId: 222,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Push to development',
        body: null,
        state: null,
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: { ref: 'refs/heads/development' },
      }));

      const pushPayload = {
        ref: 'refs/heads/development',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        sender: {
          login: 'pusher',
          id: 222,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(pushPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();

      expect(mockDetectOnPush).toHaveBeenCalledTimes(1);
    });
  });

  describe('PR comment dispatch events', () => {
    it('dispatches issue_comment created event to task', async () => {
      const issueCommentPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: {
            login: 'author',
            id: 111,
            type: 'User',
          },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 12345,
          body: 'please fix the linting errors',
          user: {
            login: 'reviewer',
            id: 222,
            type: 'User',
          },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: {
            login: 'test',
            id: 789,
          },
        },
        sender: {
          login: 'reviewer',
          id: 222,
          type: 'User',
        },
      };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 12345,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'please fix the linting errors',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: {},
      }));

      const { payload, signature } = signPayload(issueCommentPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('skips dispatch for issue_comment deleted events', async () => {
      const issueCommentPayload = {
        action: 'deleted',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: {
            login: 'author',
            id: 111,
            type: 'User',
          },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 12345,
          body: 'please fix the linting errors',
          user: {
            login: 'reviewer',
            id: 222,
            type: 'User',
          },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: {
            login: 'test',
            id: 789,
          },
        },
        sender: {
          login: 'reviewer',
          id: 222,
          type: 'User',
        },
      };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 12345,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'deleted' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'please fix the linting errors',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: {},
      }));

      const { payload, signature } = signPayload(issueCommentPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('saves pull_request_review_comment but does not dispatch', async () => {
      const reviewCommentPayload = {
        action: 'created',
        comment: {
          id: 99999,
          body: 'this variable naming is confusing',
          path: 'src/utils/helper.ts',
          line: 42,
          diff_hunk: '@@ -40,6 +40,8 @@\n+const foo = true;',
          user: {
            login: 'reviewer',
            id: 333,
            type: 'User',
          },
        },
        pull_request: {
          id: 101,
          number: 55,
          title: 'Refactor utils',
          state: 'open',
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: {
            login: 'test',
            id: 789,
          },
        },
        sender: {
          login: 'reviewer',
          id: 333,
          type: 'User',
        },
      };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 99999,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 55,
        pullRequestId: 101,
        eventType: 'pull_request_review_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 333,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Refactor utils',
        body: 'this variable naming is confusing',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: reviewCommentPayload,
      }));

      const { payload, signature } = signPayload(reviewCommentPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request_review_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('processed');
      expect(mockAuditRepo.updateNormalizationStatus).toHaveBeenCalledWith({
        id: 'audit-1',
        normalizationStatus: 'normalized',
      });
    });

    it('dispatches pull_request_review submitted event', async () => {
      const reviewPayload = {
        action: 'submitted',
        review: {
          id: 88888,
          body: 'please address these issues',
          state: 'changes_requested',
        },
        pull_request: {
          id: 101,
          number: 60,
          title: 'Add feature',
          state: 'open',
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        sender: {
          login: 'reviewer',
          id: 444,
          type: 'User',
        },
      };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 88888,
        deliveryId: null,
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 60,
        pullRequestId: 101,
        eventType: 'pull_request_review' as const,
        action: 'submitted' as const,
        senderLogin: 'reviewer',
        senderId: 444,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Add feature',
        body: 'please address these issues',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: reviewPayload,
      }));

      const { payload, signature } = signPayload(reviewPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request_review',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('processed');
    });

    it('skips dispatch for pull_request_review dismissed events', async () => {
      const reviewPayload = {
        action: 'dismissed',
        review: {
          id: 77777,
          body: 'Dismissing stale review',
          state: 'dismissed',
        },
        pull_request: {
          id: 101,
          number: 60,
          title: 'Add feature',
          state: 'open',
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        sender: {
          login: 'reviewer',
          id: 444,
          type: 'User',
        },
      };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 77777,
        deliveryId: null,
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 60,
        pullRequestId: 101,
        eventType: 'pull_request_review' as const,
        action: 'dismissed' as const,
        senderLogin: 'reviewer',
        senderId: 444,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Add feature',
        body: 'Dismissing stale review',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: reviewPayload,
      }));

      const { payload, signature } = signPayload(reviewPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request_review',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('blocks dispatch for non-whitelisted bot (intexuraos-code-worker[bot])', async () => {
      const botCommentPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 55555,
          body: 'I have addressed the review comments.',
          user: { login: 'intexuraos-code-worker[bot]', id: 888, type: 'Bot' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: { login: 'test', id: 789 },
        },
        sender: { login: 'intexuraos-code-worker[bot]', id: 888, type: 'Bot' },
      };

      const mockFindByPR = vi.fn().mockResolvedValue(ok(null));
      const services = (await import('../../../services.js')).getServices();
      services.codeTaskRepo.findByPR = mockFindByPR;

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 55555,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'intexuraos-code-worker[bot]',
        senderId: 888,
        senderType: 'Bot',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'I have addressed the review comments.',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: botCommentPayload,
      }));

      const { payload, signature } = signPayload(botCommentPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      // Non-whitelisted bot should NOT dispatch
      // Wait a tick to let the async dispatch settle
      await waitForSettlement();
      expect(mockFindByPR).not.toHaveBeenCalled();
    });

    it('blocks dispatch for non-owner user (even with @claude mention)', async () => {
      const claudeMentionPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 77777,
          body: '@claude review completeness of the design',
          user: { login: 'reviewer', id: 222, type: 'User' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: { login: 'test', id: 789 },
        },
        sender: { login: 'reviewer', id: 222, type: 'User' },
      };

      const mockFindByPR = vi.fn().mockResolvedValue(ok(null));
      const services = (await import('../../../services.js')).getServices();
      services.codeTaskRepo.findByPR = mockFindByPR;

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 77777,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: '@claude review completeness of the design',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: claudeMentionPayload,
      }));

      const { payload, signature } = signPayload(claudeMentionPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      // Non-owner sender should NOT dispatch (regardless of body content)
      await waitForSettlement();
      expect(mockFindByPR).not.toHaveBeenCalled();
    });

    it('blocks dispatch for non-owner user (even with @codex mention)', async () => {
      const codexMentionPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 88888,
          body: '@codex fix this lint error',
          user: { login: 'reviewer', id: 222, type: 'User' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: { login: 'test', id: 789 },
        },
        sender: { login: 'reviewer', id: 222, type: 'User' },
      };

      const mockFindByPR = vi.fn().mockResolvedValue(ok(null));
      const services = (await import('../../../services.js')).getServices();
      services.codeTaskRepo.findByPR = mockFindByPR;

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 88888,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: '@codex fix this lint error',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: codexMentionPayload,
      }));

      const { payload, signature } = signPayload(codexMentionPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();
      expect(mockFindByPR).not.toHaveBeenCalled();
    });

    it('blocks dispatch for non-whitelisted bots (codecov[bot])', async () => {
      const otherBotPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 66666,
          body: 'Coverage: 94.2%',
          user: { login: 'codecov[bot]', id: 777, type: 'Bot' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: { login: 'test', id: 789 },
        },
        sender: { login: 'codecov[bot]', id: 777, type: 'Bot' },
      };

      const mockFindByPR = vi.fn().mockResolvedValue(ok(null));
      const services = (await import('../../../services.js')).getServices();
      services.codeTaskRepo.findByPR = mockFindByPR;

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 66666,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'codecov[bot]',
        senderId: 777,
        senderType: 'Bot',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'Coverage: 94.2%',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: otherBotPayload,
      }));

      const { payload, signature } = signPayload(otherBotPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      // Non-whitelisted bot should NOT dispatch
      await waitForSettlement();
      expect(mockFindByPR).not.toHaveBeenCalled();
    });

    it('dispatches issue_comment from repo owner', async () => {
      const ownerCommentPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/pbuchman/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 55555,
          body: 'please fix the linting errors',
          user: { login: 'pbuchman', id: 368465, type: 'User' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'pbuchman/intexuraos',
          owner: { login: 'pbuchman', id: 368465 },
        },
        sender: { login: 'pbuchman', id: 368465, type: 'User' },
      };

      // Use real production rules — only mock dispatchService to verify it's called
      const mockDispatch = vi.fn().mockResolvedValue({ success: true, dispatched: true });
      const services = (await import('../../../services.js')).getServices();
      services.dispatchService = { dispatch: mockDispatch };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 55555,
        deliveryId: null,
        repository: 'pbuchman/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'pbuchman',
        senderId: 368465,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'please fix the linting errors',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: ownerCommentPayload,
      }));

      const { payload, signature } = signPayload(ownerCommentPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();
      // issue_comment events now return needs_triage (INT-744), not dispatched directly
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch issue_comment from chatgpt-codex-connector[bot] (needs_triage)', async () => {
      const codexBotPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/pbuchman/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 44444,
          body: 'Codex Review: Found 2 issues.',
          user: { login: 'chatgpt-codex-connector[bot]', id: 555, type: 'Bot' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'pbuchman/intexuraos',
          owner: { login: 'pbuchman', id: 368465 },
        },
        sender: { login: 'chatgpt-codex-connector[bot]', id: 555, type: 'Bot' },
      };

      // Use real production rules — only mock dispatchService to verify it's called
      const mockDispatch = vi.fn().mockResolvedValue({ success: true, dispatched: true });
      const services = (await import('../../../services.js')).getServices();
      services.dispatchService = { dispatch: mockDispatch };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 44444,
        deliveryId: null,
        repository: 'pbuchman/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'chatgpt-codex-connector[bot]',
        senderId: 555,
        senderType: 'Bot',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'Codex Review: Found 2 issues.',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: codexBotPayload,
      }));

      const { payload, signature } = signPayload(codexBotPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();
      // issue_comment events now return needs_triage (INT-744), not dispatched directly
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('blocks dispatch when payload has no repository owner', async () => {
      const noOwnerPayload = {
        action: 'created',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 33333,
          body: 'some comment',
          user: { login: 'randomuser', id: 444, type: 'User' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
        },
        sender: { login: 'randomuser', id: 444, type: 'User' },
      };

      // Use real production rules — 'randomuser' is not repo owner 'test' and not in ALLOWED_BOTS
      const mockDispatch = vi.fn().mockResolvedValue({ success: true, dispatched: false });
      const services = (await import('../../../services.js')).getServices();
      services.dispatchService = { dispatch: mockDispatch };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 33333,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'randomuser',
        senderId: 444,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'some comment',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: noOwnerPayload,
      }));

      const { payload, signature } = signPayload(noOwnerPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('dispatches edited issue_comment from claude[bot] to task', async () => {
      const claudeBotEditedPayload = {
        action: 'edited',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 99999,
          body: 'Finalized implementation plan for the task.',
          user: { login: 'claude[bot]', id: 999, type: 'Bot' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: { login: 'test', id: 789 },
        },
        sender: { login: 'claude[bot]', id: 999, type: 'Bot' },
      };

      // Use real production rules — claude[bot] is in ALLOWED_BOTS so dispatch should fire
      const mockDispatch = vi.fn().mockResolvedValue({ success: true, dispatched: true });
      const services = (await import('../../../services.js')).getServices();
      services.dispatchService = { dispatch: mockDispatch };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 99999,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'edited' as const,
        senderLogin: 'claude[bot]',
        senderId: 999,
        senderType: 'Bot',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'Finalized implementation plan for the task.',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: claudeBotEditedPayload,
      }));

      const { payload, signature } = signPayload(claudeBotEditedPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();
      // issue_comment events now return needs_triage (INT-744), not dispatched directly
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('does not dispatch edited issue_comment from regular user', async () => {
      const regularUserEditedPayload = {
        action: 'edited',
        issue: {
          id: 101,
          number: 42,
          title: 'Test PR',
          body: 'Test PR description',
          state: 'open',
          user: { login: 'author', id: 111, type: 'User' },
          pull_request: {
            url: 'https://api.github.com/repos/test/intexuraos/pulls/42',
          },
        },
        comment: {
          id: 11111,
          body: 'Updated my review comment with more details.',
          user: { login: 'reviewer', id: 222, type: 'User' },
        },
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'test/intexuraos',
          owner: { login: 'test', id: 789 },
        },
        sender: { login: 'reviewer', id: 222, type: 'User' },
      };

      // Use real production rules — 'reviewer' is not an allowed bot, so issue_comment+edited is rejected
      const mockDispatch = vi.fn().mockResolvedValue({ success: true, dispatched: false });
      const services = (await import('../../../services.js')).getServices();
      services.dispatchService = { dispatch: mockDispatch };

      mockEventRepo.save = (): Promise<ReturnType<typeof ok<GitHubPREvent>>> => Promise.resolve(ok({
        id: 'test-event-id',
        githubEventId: 11111,
        deliveryId: null,
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'edited' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'Test PR',
        body: 'Updated my review comment with more details.',
        state: 'open',
        baseBranch: null,
        mergedAt: null,
        createdAt: new Date(),
        processedAt: new Date(),
        payload: regularUserEditedPayload,
      }));

      const { payload, signature } = signPayload(regularUserEditedPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'issue_comment',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('duplicate webhook delivery', () => {
    it('should skip evaluation for duplicate webhook delivery', async () => {
      // Override save to return DUPLICATE_EVENT error
      mockEventRepo.save = vi.fn().mockResolvedValue(
        err({ code: 'DUPLICATE_EVENT' as const, message: 'Duplicate delivery: abc-123' })
      );

      const prPayload = {
        action: 'opened',
        number: 123,
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'pbuchman/intexuraos',
          owner: {
            login: 'pbuchman',
            id: 789,
          },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          merged_at: null,
        },
        sender: {
          login: 'testuser',
          id: 999,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'abc-123',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('duplicate');
      expect(mockEventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'audit-1',
          decidedBy: 'webhook_route',
          decision: 'skip',
          reason: 'duplicate_delivery',
        })
      );
      expect(mockEventLogEntryRepo.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-1',
          decisionOutcome: 'skip',
        })
      );
      expect(mockAuditRepo.updateNormalizationStatus).toHaveBeenCalledWith({
        id: 'audit-1',
        normalizationStatus: 'duplicate',
      });

      // Verify evaluator was NOT called
      const services = (await import('../../../services.js')).getServices();
      expect(services.unifiedEvaluator.evaluate).not.toHaveBeenCalled();
    });

    it('should acknowledge and log error for non-duplicate save failures', async () => {
      // Override save to return a generic FIRESTORE_ERROR
      mockEventRepo.save = vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
      );

      const prPayload = {
        action: 'opened',
        number: 123,
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'pbuchman/intexuraos',
          owner: {
            login: 'pbuchman',
            id: 789,
          },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          merged_at: null,
        },
        sender: {
          login: 'testuser',
          id: 999,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'def-456',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('acknowledged');
      expect(mockEventDecisionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 'audit-1',
          decidedBy: 'webhook_route',
          decision: 'skip',
          reason: 'normalized_event_save_failed',
        })
      );
      expect(mockEventLogEntryRepo.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'audit-1',
          decisionOutcome: 'skip',
        })
      );
      expect(mockAuditRepo.updateNormalizationStatus).toHaveBeenCalledWith({
        id: 'audit-1',
        normalizationStatus: 'failed',
      });
    });
  });

  describe('branch coverage for audit and route fallbacks', () => {
    it('records unknown event names and null sender types when auth passes without a typed event header', async () => {
      const payloadWithUntypedSender = {
        zen: 'hi',
        sender: {
          login: 'testuser',
          id: 999,
        },
      };
      const { payload, signature } = signPayload(payloadWithUntypedSender);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockAuditRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        githubEventName: 'unknown',
        eventType: 'unknown',
        senderType: null,
      }));
      expect(mockEventLogEntryRepo.createPending).toHaveBeenCalledWith(expect.objectContaining({
        githubEventName: 'unknown',
        eventType: 'unknown',
      }));
    });

    it('returns 500 when ping route-level decision persistence fails before completion', async () => {
      mockEventDecisionRepo.save = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'decision failed',
      }));
      setServices({
        ...mockServices,
        eventDecisionRepo: mockEventDecisionRepo,
      });

      const { payload, signature } = signPayload({ action: 'opened' });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when the event log repo disappears before ping decision completion', async () => {
      mockEventLogEntryRepo.createPending = vi.fn().mockImplementation(async (input) => {
        const { gitHubEventLogEntryRepo: _ignoredEventLogRepo, ...servicesWithoutEventLogRepo } = mockServices;
        setServices({
          ...servicesWithoutEventLogRepo,
        } as ServiceContainer);

        return ok({
          ...input,
          decisionId: null,
        });
      });
      setServices({
        ...mockServices,
        gitHubEventLogEntryRepo: mockEventLogEntryRepo,
      });

      const { payload, signature } = signPayload({ action: 'opened' });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when ping decision completion fails', async () => {
      mockEventLogEntryRepo.complete = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'completion failed',
      }));
      setServices({
        ...mockServices,
        gitHubEventLogEntryRepo: mockEventLogEntryRepo,
      });

      const { payload, signature } = signPayload({ action: 'opened' });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('acknowledges ping events even when audit normalization update fails', async () => {
      mockAuditRepo.updateNormalizationStatus = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'audit status failed',
      }));
      setServices({
        ...mockServices,
        gitHubWebhookAuditEventRepo: mockAuditRepo,
      });

      const { payload, signature } = signPayload({ action: 'opened' });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('acknowledges ping events when the audit repo is no longer configured during route-level persistence', async () => {
      mockEventLogEntryRepo.createPending = vi.fn().mockImplementation(async (input) => {
        const { gitHubWebhookAuditEventRepo: _ignoredAuditRepo, ...servicesWithoutAuditRepo } = mockServices;
        setServices({
          ...servicesWithoutAuditRepo,
        } as ServiceContainer);

        return ok({
          ...input,
          decisionId: null,
        });
      });
      setServices({
        ...mockServices,
        gitHubEventLogEntryRepo: mockEventLogEntryRepo,
      });

      const { payload, signature } = signPayload({ action: 'opened' });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockAuditRepo.updateNormalizationStatus).not.toHaveBeenCalled();
    });

    it('returns 500 when auth-passed logging repositories are not configured', async () => {
      const {
        gitHubWebhookAuditEventRepo: _ignoredAuditRepo,
        gitHubEventLogEntryRepo: _ignoredEventLogRepo,
        ...servicesWithoutAuditAndLogRepos
      } = mockServices;
      setServices({
        ...servicesWithoutAuditAndLogRepos,
      } as ServiceContainer);

      const { payload, signature } = signPayload({ action: 'opened' });
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when the pending live-log row cannot be created', async () => {
      mockEventLogEntryRepo.createPending = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'create pending failed',
      }));
      setServices({
        ...mockServices,
        gitHubEventLogEntryRepo: mockEventLogEntryRepo,
      });

      const { payload, signature } = signPayload(createPullRequestPayload());
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when out-of-scope events cannot persist their route-level decision', async () => {
      mockEventDecisionRepo.save = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'decision failed',
      }));
      setServices({
        ...mockServices,
        eventDecisionRepo: mockEventDecisionRepo,
      });

      const { payload, signature } = signPayload(createPullRequestPayload({
        repository: {
          id: 456,
          name: 'external-repo',
          full_name: 'someone/external-repo',
          owner: {
            login: 'someone',
            id: 789,
          },
        },
      }));
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when duplicate deliveries cannot persist their skip decision', async () => {
      mockEventRepo.save = vi.fn().mockResolvedValue(err({
        code: 'DUPLICATE_EVENT',
        message: 'duplicate delivery',
      }));
      mockEventDecisionRepo.save = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'decision failed',
      }));
      setServices({
        ...mockServices,
        gitHubPREventRepo: mockEventRepo,
        eventDecisionRepo: mockEventDecisionRepo,
      });

      const { payload, signature } = signPayload(createPullRequestPayload());
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'dup-500',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('returns 500 when normalized save failures cannot persist their skip decision', async () => {
      mockEventRepo.save = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'save failed',
      }));
      mockEventDecisionRepo.save = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'decision failed',
      }));
      setServices({
        ...mockServices,
        gitHubPREventRepo: mockEventRepo,
        eventDecisionRepo: mockEventDecisionRepo,
      });

      const { payload, signature } = signPayload(createPullRequestPayload());
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'save-500',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
    });

    it('skips best-effort audit normalization updates when the audit repo is no longer configured', async () => {
      mockEventRepo.save = vi.fn().mockImplementation(async (input) => {
        const { gitHubWebhookAuditEventRepo: _ignoredAuditRepo, ...servicesWithoutAuditRepo } = mockServices;
        setServices({
          ...servicesWithoutAuditRepo,
        } as ServiceContainer);

        return ok({
          id: 'saved-event-1',
          ...input,
          processedAt: new Date('2026-03-12T10:00:01.000Z'),
        });
      });
      setServices({
        ...mockServices,
        gitHubPREventRepo: mockEventRepo,
      });

      const { payload, signature } = signPayload(createPullRequestPayload());
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'normalized-no-audit',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('acknowledges processed events when audit normalization update returns an error', async () => {
      mockAuditRepo.updateNormalizationStatus = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR',
        message: 'audit update failed',
      }));
      setServices({
        ...mockServices,
        gitHubWebhookAuditEventRepo: mockAuditRepo,
      });

      const { payload, signature } = signPayload(createPullRequestPayload());
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'normalized-warn',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
    });

    it('does not create a fallback route decision when evaluator failure finds an existing decision', async () => {
      mockEventDecisionRepo.findByEventIds = vi.fn().mockResolvedValue(ok([{
        id: 'ed_audit-1',
        eventId: 'audit-1',
        repository: 'pbuchman/intexuraos',
        pullRequestNumber: 123,
        eventType: 'pull_request',
        eventAction: 'opened',
        senderLogin: 'testuser',
        decidedBy: 'github_agent',
        decision: 'dispatch',
        reason: 'already saved',
        createdAt: new Date('2026-03-12T10:00:01.000Z'),
        decisionLatencyMs: 5,
      }]));
      setServices({
        ...mockServices,
        eventDecisionRepo: mockEventDecisionRepo,
        unifiedEvaluator: {
          evaluate: vi.fn().mockRejectedValue(new Error('evaluation crashed')),
        },
      });

      const { payload, signature } = signPayload(createPullRequestPayload());
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'eval-existing',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      await vi.waitFor(() => {
        expect(mockEventDecisionRepo.findByEventIds).toHaveBeenCalledWith(['audit-1']);
      });
      expect(mockEventDecisionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('v8 ignore block coverage', () => {
    it('acknowledges event when gitHubPREventRepo.save() returns FIRESTORE_ERROR', async () => {
      mockEventRepo.save = (): Promise<ReturnType<typeof err<{ code: 'FIRESTORE_ERROR'; message: string }>>> =>
        Promise.resolve(err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' }));

      setServices({
        ...mockServices,
        gitHubPREventRepo: mockEventRepo,
      });

      const { payload, signature } = signPayload(createPullRequestPayload());

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'save-error',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('acknowledged');
    });

    it('processes event but warns when gitHubPRSummaryRepo.upsert() fails', async () => {
      const upsertMock = vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Summary upsert failed' })
      );

      setServices({
        ...mockServices,
        gitHubPRSummaryRepo: {
          ...mockSummaryRepo,
          upsert: upsertMock,
        },
      });

      const { payload, signature } = signPayload(createPullRequestPayload());

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'upsert-error',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('processed');
      expect(upsertMock).toHaveBeenCalled();
    });

    it('returns 500 when persistRouteDecision fails for invalid payload', async () => {
      // Mock eventDecisionRepo.save to return an error to trigger the !saved branch
      mockEventDecisionRepo.save = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR' as const,
        message: 'Database unavailable'
      }));

      setServices({
        ...mockServices,
        eventDecisionRepo: mockEventDecisionRepo,
      });

      const invalidPayload = {
        action: 'opened',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        // sender and pull_request intentionally omitted so parsing fails
      };

      const { payload, signature } = signPayload(invalidPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'persist-error-invalid',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });

    it('returns 500 when persistRouteDecision fails for unsupported event', async () => {
      // Mock eventDecisionRepo.save to return an error to trigger the !saved branch
      mockEventDecisionRepo.save = vi.fn().mockResolvedValue(err({
        code: 'FIRESTORE_ERROR' as const,
        message: 'Database unavailable'
      }));

      setServices({
        ...mockServices,
        eventDecisionRepo: mockEventDecisionRepo,
      });

      const unsupportedPayload = {
        action: 'queued',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: {
            login: 'intexuraos',
            id: 789,
          },
        },
        sender: {
          login: 'octocat',
          id: 1,
          type: 'User',
        },
      };

      const { payload, signature } = signPayload(unsupportedPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'workflow_run',
          'x-github-delivery': 'persist-error-unsupported',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('automation log recording', () => {
    it('records webhook_received for pull_request events with PR context and resolved userId', async () => {
      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-wh-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      expect(mockServices.automationLog.record).toHaveBeenCalledWith(
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        {
          type: 'webhook_received',
          eventType: 'pull_request',
          action: 'opened',
          sender: 'testuser',
          deliveryId: 'delivery-wh-1',
          summary: 'Test PR',
        },
        'user-1',
      );

      // Verify the sender login was resolved via userServiceClient
      expect(mockServices.userServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('testuser');
    });

    it('records webhook_received with undefined userId when resolveGitHubUsername fails', async () => {
      vi.mocked(mockServices.userServiceClient.resolveGitHubUsername).mockResolvedValue(
        err({ code: 'API_ERROR' as const, message: 'User not found' })
      );

      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-wh-noid-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      expect(mockServices.automationLog.record).toHaveBeenCalledWith(
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        {
          type: 'webhook_received',
          eventType: 'pull_request',
          action: 'opened',
          sender: 'testuser',
          deliveryId: 'delivery-wh-noid-1',
          summary: 'Test PR',
        },
        undefined,
      );
    });

    it('records webhook_received with undefined userId when resolveGitHubUsername throws', async () => {
      vi.mocked(mockServices.userServiceClient.resolveGitHubUsername).mockRejectedValue(
        new Error('network error')
      );

      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-wh-throw-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      expect(mockServices.automationLog.record).toHaveBeenCalledWith(
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        {
          type: 'webhook_received',
          eventType: 'pull_request',
          action: 'opened',
          sender: 'testuser',
          deliveryId: 'delivery-wh-throw-1',
          summary: 'Test PR',
        },
        undefined,
      );
    });

    it('does not record webhook_received for ping events (no PR context)', async () => {
      const { payload, signature } = signPayload({ zen: 'keep it real' });

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'ping',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockServices.automationLog.record).not.toHaveBeenCalled();
    });

    it('does not record webhook_received for push events (pullRequestNumber is 0)', async () => {
      const pushPayload = {
        ref: 'refs/heads/main',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'intexuraos/intexuraos',
          owner: { login: 'intexuraos', id: 789 },
        },
        sender: { login: 'pusher', id: 222, type: 'User' },
      };

      const { payload, signature } = signPayload(pushPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockServices.automationLog.record).not.toHaveBeenCalled();
    });

    it('records skipped event for repository_out_of_scope with PR context', async () => {
      const prPayload = createPullRequestPayload({
        repository: {
          id: 456,
          name: 'other-repo',
          full_name: 'someone/other-repo',
          owner: { login: 'someone', id: 789 },
        },
      });
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-oos-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.message).toBe('ignored');

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 2);

      // Both webhook_received and skipped should be recorded (order may vary due to async userId resolution)
      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      expect(recordCalls.length).toBe(2);
      const webhookReceivedCall = recordCalls.find((c) => (c[1] as { type: string }).type === 'webhook_received');
      const skippedCall = recordCalls.find((c) => (c[1] as { type: string }).type === 'skipped');
      expect(webhookReceivedCall).toEqual([
        { repository: 'someone/other-repo', prNumber: 123 },
        {
          type: 'webhook_received',
          eventType: 'pull_request',
          action: 'opened',
          sender: 'testuser',
          deliveryId: 'delivery-oos-1',
          summary: 'Test PR',
        },
        'user-1',
      ]);
      expect(skippedCall).toEqual([
        { repository: 'someone/other-repo', prNumber: 123 },
        { type: 'skipped', decidedBy: 'webhook_route', reason: 'repository_out_of_scope' },
      ]);
    });

    it('records skipped event for duplicate_delivery with PR context', async () => {
      mockEventRepo.save = vi.fn().mockResolvedValue(
        err({ code: 'DUPLICATE_EVENT' as const, message: 'Duplicate delivery' })
      );

      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-dup-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.message).toBe('duplicate');

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 2);

      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      expect(recordCalls.length).toBe(2);
      expect(recordCalls[0]).toEqual([
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        {
          type: 'webhook_received',
          eventType: 'pull_request',
          action: 'opened',
          sender: 'testuser',
          deliveryId: 'delivery-dup-1',
          summary: 'Test PR',
        },
        'user-1',
      ]);
      expect(recordCalls[1]).toEqual([
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        { type: 'skipped', decidedBy: 'webhook_route', reason: 'duplicate_delivery' },
      ]);
    });

    it('does not break webhook processing when automationLog.record() rejects', async () => {
      vi.mocked(mockServices.automationLog.record).mockRejectedValue(new Error('log service down'));

      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-err-1',
        },
        body: payload,
      });

      // Webhook should still succeed even though automation log failed
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.message).toBe('processed');
    });

    it('records webhook_received with fallback values when headers are missing', async () => {
      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          // No x-github-delivery header
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      expect(mockServices.automationLog.record).toHaveBeenCalledWith(
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        expect.objectContaining({
          type: 'webhook_received',
          deliveryId: 'unknown',
        }),
        'user-1',
      );
    });

    it('skips automation log for repository_out_of_scope without PR context (L496)', async () => {
      const pushPayload = {
        action: 'completed',
        repository: {
          id: 456,
          name: 'other-repo',
          full_name: 'other-org/other-repo',
          owner: { login: 'other-org', id: 789 },
        },
        sender: { login: 'testuser', id: 999, type: 'User' },
      };

      const { payload, signature } = signPayload(pushPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-no-pr-scope',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      // Wait a tick for detached async
      await waitForSettlement();

      // Only webhook_received should NOT be recorded because push has PR=0
      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      const skippedCall = recordCalls.find((c) => (c[1] as { type: string }).type === 'skipped');
      // Since pullRequestNumber is 0, skipped event should NOT be in automation log
      expect(skippedCall).toBeUndefined();
    });

    it('skips automation log for duplicate_delivery without PR context (L531)', async () => {
      // First request to create the event
      const pushPayload = createPullRequestPayload({
        pull_request: undefined,
      } as never);
      delete (pushPayload as Record<string, unknown>)['pull_request'];

      const { payload, signature } = signPayload(pushPayload);

      await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-dup-no-pr',
        },
        body: payload,
      });

      // Send duplicate - mock save to return DUPLICATE_EVENT
      mockEventRepo.save = vi.fn().mockResolvedValue(
        err({ code: 'DUPLICATE_EVENT' as const, message: 'Duplicate' })
      );
      setServices({ ...mockServices, gitHubPREventRepo: mockEventRepo });

      const { payload: payload2, signature: signature2 } = signPayload(pushPayload);
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature2,
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-dup-no-pr',
        },
        body: payload2,
      });

      expect(response.statusCode).toBe(200);

      await waitForSettlement();

      // skipped event should NOT be in automation log since pullRequestNumber is 0
      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      const skippedCall = recordCalls.find((c) => (c[1] as { reason?: string }).reason === 'duplicate_delivery');
      expect(skippedCall).toBeUndefined();
    });

    it('records webhook_received with null sender (L403/L423 fallback)', async () => {
      const prPayload = createPullRequestPayload();
      delete (prPayload as Record<string, unknown>)['sender'];

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-no-sender',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      const webhookReceivedCall = recordCalls.find((c) => (c[1] as { type: string }).type === 'webhook_received');
      expect(webhookReceivedCall).toBeDefined();
      if (webhookReceivedCall !== undefined) {
        expect((webhookReceivedCall[1] as { sender: string }).sender).toBe('unknown');
      }
    });

    it('records webhook_received with null resolved user (L409)', async () => {
      vi.mocked(mockServices.userServiceClient.resolveGitHubUsername).mockResolvedValue(
        ok(null)
      );

      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-null-user',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      // tokenUserId should be undefined since resolvedUser is null
      expect(mockServices.automationLog.record).toHaveBeenCalledWith(
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        expect.objectContaining({
          type: 'webhook_received',
        }),
        undefined,
      );
    });

    it('records webhook_received without action field (L422 fallback)', async () => {
      const prPayload = createPullRequestPayload();
      delete (prPayload as Record<string, unknown>)['action'];

      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-no-action',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      const webhookReceivedCall = recordCalls.find((c) => (c[1] as { type: string }).type === 'webhook_received');
      expect(webhookReceivedCall).toBeDefined();
      if (webhookReceivedCall !== undefined) {
        expect((webhookReceivedCall[1] as { action: string }).action).toBe('unknown');
      }
    });

    it('records webhook_received without eventUrl when not available (L425)', async () => {
      // push events don't have an extractable event URL
      const pushPayload = {
        action: 'pushed',
        repository: {
          id: 456,
          name: 'intexuraos',
          full_name: 'pbuchman/intexuraos',
          owner: { login: 'pbuchman', id: 789 },
        },
        pull_request: {
          id: 101,
          number: 123,
          title: 'Test PR',
          body: 'Test description',
          state: 'open',
          merged_at: null,
        },
        sender: { login: 'testuser', id: 999, type: 'User' },
      };

      const { payload, signature } = signPayload(pushPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'push',
          'x-github-delivery': 'delivery-no-eventurl',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 1);

      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      const webhookReceivedCall = recordCalls.find((c) => (c[1] as { type: string }).type === 'webhook_received');
      expect(webhookReceivedCall).toBeDefined();
      if (webhookReceivedCall !== undefined) {
        // eventUrl should not be in the record since extractEventUrl returns null for push
        expect((webhookReceivedCall[1] as Record<string, unknown>)['eventUrl']).toBeUndefined();
      }
    });

    it('persists fallback decision when findByEventIds is undefined on eventDecisionRepo (L230)', async () => {
      setServices({
        ...mockServices,
        eventDecisionRepo: {
          save: mockEventDecisionRepo.save,
          // findByEventIds intentionally omitted (undefined)
        } as import('../../../domain/repositories/eventDecisionRepository.js').EventDecisionRepository,
        unifiedEvaluator: {
          evaluate: vi.fn().mockRejectedValue(new Error('evaluation crashed')),
        },
      });

      const { payload, signature } = signPayload(createPullRequestPayload());
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'eval-no-findByEventIds',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);

      // The fallback decision should have been saved since findByEventIds is undefined
      // and the code skips the duplicate check
      await vi.waitFor(() => {
        expect(mockEventDecisionRepo.save).toHaveBeenCalled();
      });
    });

    it('records skipped event for normalized_event_save_failed with PR context', async () => {
      mockEventRepo.save = vi.fn().mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
      );

      const prPayload = createPullRequestPayload();
      const { payload, signature } = signPayload(prPayload);

      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-save-fail-1',
        },
        body: payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.message).toBe('acknowledged');

      await waitForDetachedAsync(() => vi.mocked(mockServices.automationLog.record).mock.calls.length >= 2);

      const recordCalls = vi.mocked(mockServices.automationLog.record).mock.calls;
      expect(recordCalls.length).toBe(2);
      expect(recordCalls[1]).toEqual([
        { repository: 'pbuchman/intexuraos', prNumber: 123 },
        { type: 'skipped', decidedBy: 'webhook_route', reason: 'normalized_event_save_failed' },
      ]);
    });
  });

  describe('PR close → handlePrClose (merge transitions + label cleanup)', () => {
    let mockMarkQa: ReturnType<typeof vi.fn>;
    let mockRemoveLabel: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockMarkQa = vi.fn().mockResolvedValue(undefined);
      mockRemoveLabel = vi.fn().mockResolvedValue(undefined);
      Object.assign(mockServices, { linearIssueService: { markQa: mockMarkQa, markTodo: vi.fn().mockResolvedValue(undefined), removeLabel: mockRemoveLabel } });
    });

    it('should transition to QA and remove label when PR is closed with merge', async () => {
      vi.mocked(mockServices.codeTaskRepo.findByPR).mockResolvedValue(
        ok({
          id: 'task_merge-1',
          userId: 'merge-user',
          linearIssueId: 'INT-999',
        } as never)
      );

      const mergedPayload = createPullRequestPayload({
        action: 'closed',
        pull_request: {
          id: 101,
          number: 123,
          title: '[INT-999] Test PR',
          body: 'Fixes INT-999',
          state: 'closed',
          merged_at: '2026-03-21T01:00:00Z',
        },
      });

      const { payload, signature } = signPayload(mergedPayload);
      await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-merge-1',
        },
        body: payload,
      });

      await waitForDetachedAsync(() => mockMarkQa.mock.calls.length >= 1);
      expect(mockMarkQa).toHaveBeenCalledWith('merge-user', 'INT-999');
    });

    it('should remove label but NOT transition state when PR closed without merge', async () => {
      vi.mocked(mockServices.codeTaskRepo.findByPR).mockResolvedValue(
        ok({
          id: 'task_close-1',
          userId: 'close-user',
          linearIssueId: 'INT-888',
        } as never)
      );

      const closedPayload = createPullRequestPayload({
        action: 'closed',
        pull_request: {
          id: 101,
          number: 123,
          title: '[INT-888] Test PR',
          body: 'Test description',
          state: 'closed',
          merged_at: null,
        },
      });

      const { payload, signature } = signPayload(closedPayload);
      await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-close-no-merge-1',
        },
        body: payload,
      });

      await waitForDetachedAsync(() => mockRemoveLabel.mock.calls.length >= 1);
      expect(mockRemoveLabel).toHaveBeenCalledWith('close-user', 'INT-888', 'ready-to-merge');
      expect(mockMarkQa).not.toHaveBeenCalled();
    });

    it('should NOT call handlePrClose when PR is opened', async () => {
      const openedPayload = createPullRequestPayload({ action: 'opened' });

      const { payload, signature } = signPayload(openedPayload);
      await app.inject({
        method: 'POST',
        url: '/webhooks/github',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-github-event': 'pull_request',
          'x-github-delivery': 'delivery-opened-no-merge-1',
        },
        body: payload,
      });

      await waitForDetachedAsync(() => vi.mocked(mockServices.unifiedEvaluator.evaluate).mock.calls.length >= 1);
      expect(mockMarkQa).not.toHaveBeenCalled();
      expect(mockRemoveLabel).not.toHaveBeenCalled();
    });
  });
});
