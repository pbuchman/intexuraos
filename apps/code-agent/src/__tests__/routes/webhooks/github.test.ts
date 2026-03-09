/**
 * Tests for GitHub webhook route
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomBytes, createHmac } from 'node:crypto';
import { ok } from '@intexuraos/common-core';
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
import { ALLOWED_BOTS } from '../../../routes/webhooks/github.js';

const mockedJwtVerify = vi.mocked(jose.jwtVerify);

describe('POST /webhooks/github', () => {
  let app: FastifyInstance;
  let testSecret: string;
  let mockEventRepo: GitHubPREventRepository;
  let mockSummaryRepo: GitHubPRSummaryRepository;

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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 789,
        pullRequestId: 101,
        eventType: 'pull_request' as const,
        action: 'opened' as const,
        senderLogin: 'testuser',
        senderId: 999,
        senderType: 'User',
        title: 'Test PR',
        body: 'Test description',
        state: 'open',
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
      deleteTask: vi.fn().mockResolvedValue(ok(undefined)),
      findOldestQueued: vi.fn().mockResolvedValue(ok(null)),
      countQueued: vi.fn().mockResolvedValue(ok(0)),
      findPlannedTaskByLinearIssue: vi.fn().mockResolvedValue(ok(null)),
    };

    // Create mock PR summary repo
    mockSummaryRepo = {
      upsert: vi.fn().mockResolvedValue(ok(undefined)),
      findRecentlyActive: vi.fn().mockResolvedValue(ok([])),
    };

    // Setup services with all required fields
    const mockServices: ServiceContainer = {
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
      metricsClient: {} as never,
      workerSettingsRepo: {} as never,
      workerHealthProbe: {} as never,
      gitHubPREventRepo: mockEventRepo,
      gitHubPRSummaryRepo: mockSummaryRepo,
      turnMetricsRepo: {} as never,
      userServiceClient: {} as never,
      gitHubPRClient: {} as never,
      webhookRules: createWebhookRulesService([
        new ActionableEventRule(ALLOWED_BOTS),
        new SenderWhitelistRule(ALLOWED_BOTS),
        new SkipPrefixRule(['@claude', '@codex', '@ignore']),
      ]),
      dispatchService: { dispatch: vi.fn().mockResolvedValue({ success: true, dispatched: false }) },
      toolCallingClient: undefined,
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

    it('triggers GitHub Agent evaluation when toolCallingClient is configured', async () => {
      // Reconfigure services with a toolCallingClient to cover the dispatch branch
      const { getServices, setServices: setServicesAgain } = await import('../../../services.js');
      const currentServices = getServices();
      const mockRun = vi.fn().mockResolvedValue(ok({
        content: 'done',
        toolCallsMade: 0,
        iterationCount: 1,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.001 },
      }));
      setServicesAgain({
        ...currentServices,
        toolCallingClient: { run: mockRun },
        gitHubPRClient: {
          updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
          getPullRequestFiles: vi.fn().mockResolvedValue(ok([])),
          getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
          postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
        },
      });

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

      // Give the fire-and-forget evaluatePREvent a tick to start
      await new Promise((resolve) => { setTimeout(resolve, 50); });

      // The LLM run should have been called (fire-and-forget)
      expect(mockRun).toHaveBeenCalled();
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        title: 'Test PR',
        body: 'please fix the linting errors',
        state: 'open',
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'deleted' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        title: 'Test PR',
        body: 'please fix the linting errors',
        state: 'open',
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 55,
        pullRequestId: 101,
        eventType: 'pull_request_review_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 333,
        senderType: 'User',
        title: 'Refactor utils',
        body: 'this variable naming is confusing',
        state: 'open',
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
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 60,
        pullRequestId: 101,
        eventType: 'pull_request_review' as const,
        action: 'submitted' as const,
        senderLogin: 'reviewer',
        senderId: 444,
        senderType: 'User',
        title: 'Add feature',
        body: 'please address these issues',
        state: 'open',
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
        repository: 'intexuraos/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 60,
        pullRequestId: 101,
        eventType: 'pull_request_review' as const,
        action: 'dismissed' as const,
        senderLogin: 'reviewer',
        senderId: 444,
        senderType: 'User',
        title: 'Add feature',
        body: 'Dismissing stale review',
        state: 'open',
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'intexuraos-code-worker[bot]',
        senderId: 888,
        senderType: 'Bot',
        title: 'Test PR',
        body: 'I have addressed the review comments.',
        state: 'open',
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
      await new Promise((resolve) => { setTimeout(resolve, 50); });
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        title: 'Test PR',
        body: '@claude review completeness of the design',
        state: 'open',
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
      await new Promise((resolve) => { setTimeout(resolve, 50); });
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        title: 'Test PR',
        body: '@codex fix this lint error',
        state: 'open',
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

      await new Promise((resolve) => { setTimeout(resolve, 50); });
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'codecov[bot]',
        senderId: 777,
        senderType: 'Bot',
        title: 'Test PR',
        body: 'Coverage: 94.2%',
        state: 'open',
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
      await new Promise((resolve) => { setTimeout(resolve, 50); });
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
        repository: 'pbuchman/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'pbuchman',
        senderId: 368465,
        senderType: 'User',
        title: 'Test PR',
        body: 'please fix the linting errors',
        state: 'open',
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

      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.objectContaining({ repository: 'pbuchman/intexuraos', pullRequestNumber: 42 }) })
      );
    });

    it('dispatches issue_comment from chatgpt-codex-connector[bot]', async () => {
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
        repository: 'pbuchman/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'chatgpt-codex-connector[bot]',
        senderId: 555,
        senderType: 'Bot',
        title: 'Test PR',
        body: 'Codex Review: Found 2 issues.',
        state: 'open',
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

      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.objectContaining({ repository: 'pbuchman/intexuraos', pullRequestNumber: 42 }) })
      );
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'created' as const,
        senderLogin: 'randomuser',
        senderId: 444,
        senderType: 'User',
        title: 'Test PR',
        body: 'some comment',
        state: 'open',
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

      await new Promise((resolve) => { setTimeout(resolve, 50); });
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'edited' as const,
        senderLogin: 'claude[bot]',
        senderId: 999,
        senderType: 'Bot',
        title: 'Test PR',
        body: 'Finalized implementation plan for the task.',
        state: 'open',
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

      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.objectContaining({ repository: 'test/intexuraos', pullRequestNumber: 42 }) })
      );
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
        repository: 'test/intexuraos',
        repositoryId: 456,
        pullRequestNumber: 42,
        pullRequestId: 0,
        eventType: 'issue_comment' as const,
        action: 'edited' as const,
        senderLogin: 'reviewer',
        senderId: 222,
        senderType: 'User',
        title: 'Test PR',
        body: 'Updated my review comment with more details.',
        state: 'open',
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

      await new Promise((resolve) => { setTimeout(resolve, 50); });
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });
});

