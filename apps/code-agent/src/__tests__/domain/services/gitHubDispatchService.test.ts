import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { createWebhookDispatchService } from '../../../domain/services/gitHubDispatchService.js';
import type { DispatchContext, WebhookDispatchResult, WebhookDispatchServiceDeps } from '../../../domain/services/gitHubDispatchService.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import type { RuleOutcome } from '../../../domain/services/gitHubWebhookRules.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../domain/usecases/createTaskForPR.js', () => ({
  createTaskForPR: vi.fn(),
}));

vi.mock('../../../domain/usecases/sendTaskMessage.js', () => ({
  sendTaskMessage: vi.fn(),
}));

import { createTaskForPR } from '../../../domain/usecases/createTaskForPR.js';
import { sendTaskMessage } from '../../../domain/usecases/sendTaskMessage.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';

const mockedCreateTaskForPR = vi.mocked(createTaskForPR);
const mockedSendTaskMessage = vi.mocked(sendTaskMessage);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createMockGitHubPRClient(): GitHubPRClient {
  return {
    updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
    getPullRequestFiles: vi.fn().mockResolvedValue(ok([])),
    getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
    getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('main')),
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 1 })),
  } as unknown as GitHubPRClient;
}

function createMockUserServiceClient(): UserServiceClient {
  return {
    getApiKeys: vi.fn().mockResolvedValue(ok({})),
    getLlmClient: vi.fn().mockResolvedValue(err({ code: 'NO_API_KEY', message: 'mock' })),
    reportLlmSuccess: vi.fn().mockResolvedValue(undefined),
    getOAuthToken: vi.fn().mockResolvedValue(
      ok({ accessToken: 'ghp_test_token', email: 'test@example.com' })
    ),
    resolveGitHubUsername: vi.fn().mockResolvedValue(ok(null)),
  } as unknown as UserServiceClient;
}

const mockEvent: GitHubPREvent = {
  id: 'event-123',
  githubEventId: 123,
  deliveryId: null,
  repository: 'test-owner/test-repo',
  repositoryId: 54321,
  pullRequestNumber: 42,
  pullRequestId: 12345,
  eventType: 'pull_request',
  action: 'opened',
  senderLogin: 'test-sender',
  senderId: 999,
  senderType: 'User',
  title: 'Test PR',
  body: 'Test description',
  state: 'open',
  baseBranch: null,
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {},
};

const mockDecision: RuleOutcome = {
  action: 'dispatch',
  reason: 'ALL_RULES_PASSED',
};

function createMockDeps(overrides: Partial<WebhookDispatchServiceDeps> = {}): WebhookDispatchServiceDeps {
  return {
    gitHubPREventRepo: {
      findByPullRequest: vi.fn().mockResolvedValue(ok([])),
      save: vi.fn(),
      findByRepository: vi.fn(),
      findAll: vi.fn(),
      findReviewComments: vi.fn(),
    } as never,
    codeTaskRepo: {
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn(),
      findById: vi.fn(),
      findByIdForUser: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
      hasActiveTaskForLinearIssue: vi.fn(),
      findZombieTasks: vi.fn(),
      countByUserToday: vi.fn(),
      findArchivableTasks: vi.fn(),
      archiveTaskLogs: vi.fn(),
      deleteTask: vi.fn(),
      findOldestQueued: vi.fn(),
      countQueued: vi.fn(),
    } as never,
    logLineRepo: {} as never,
    userLookupService: {} as never,
    linearIssueService: {} as never,
    taskDispatcher: {} as never,
    whatsappNotifier: {} as never,
    workerSettingsRepo: {} as never,
    statusMirrorService: {} as never,
    gitHubPRClient: createMockGitHubPRClient(),
    userServiceClient: createMockUserServiceClient(),
    firestore: {} as never,
    messageBuilder: {
      build: vi.fn().mockReturnValue('built-message'),
    } as never,
    allowedBots: new Set(['claude[bot]', 'chatgpt-codex-connector[bot]']),
    orchestratorSecret: 'test-secret',
    serviceUrl: 'http://localhost:8080',
    ...overrides,
  };
}

describe('GitHubDispatchService', () => {
  let deps: WebhookDispatchServiceDeps;
  let context: DispatchContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = { event: mockEvent, decision: mockDecision, logger: mockLogger };
  });

  describe('dispatch — existing task path', () => {
    it('should send message to existing task via sendTaskMessage', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456', linearIssueId: 'INT-100' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-123',
      });
      expect(deps.messageBuilder.build).toHaveBeenCalledWith(mockEvent);
      expect(mockedSendTaskMessage).toHaveBeenCalledWith(
        expect.objectContaining({ logger: mockLogger }),
        { taskId: 'task-123', userId: 'user-456', message: 'built-message' }
      );
      expect(vi.mocked(deps.gitHubPRClient.postPRComment)).toHaveBeenCalledWith(
        'ghp_test_token',
        'test-owner',
        'test-repo',
        42,
        expect.stringContaining('**Dispatch outcome:** Existing task queued')
      );
      expect(vi.mocked(deps.gitHubPRClient.updatePRTitle)).not.toHaveBeenCalled();
    });

    it('should post immediate PR comment when existing task is resumed', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456', linearIssueId: 'INT-100' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'resumed' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-123',
      });
      expect(vi.mocked(deps.gitHubPRClient.postPRComment)).toHaveBeenCalledWith(
        'ghp_test_token',
        'test-owner',
        'test-repo',
        42,
        expect.stringContaining('**Dispatch outcome:** Existing task resumed')
      );
    });

    it('should return failure when sendTaskMessage fails', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(err({ code: 'worker_error' as const, message: 'Worker timeout' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: false,
        dispatched: false,
        taskId: 'task-123',
        error: 'Worker timeout',
      });
      expect(vi.mocked(deps.gitHubPRClient.postPRComment)).not.toHaveBeenCalled();
    });

    it('should keep dispatch successful when PR comment posting fails', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456', linearIssueId: 'INT-100' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));
      vi.mocked(deps.gitHubPRClient.postPRComment).mockResolvedValue(
        err({ code: 'UNAUTHORIZED', message: 'Bad token' })
      );

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-123',
      });
    });
  });

  describe('dispatch — new task path', () => {
    it('should create task via createTaskForPR when no task exists', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-789' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-789',
      });
      expect(mockedCreateTaskForPR).toHaveBeenCalledWith(
        expect.objectContaining({ logger: mockLogger }),
        expect.objectContaining({
          repository: 'test-owner/test-repo',
          prNumber: 42,
          senderLogin: 'test-sender',
          comment: 'Test description',
          eventId: 'event-123',
          prTitle: 'Test PR',
        })
      );
    });

    it('should return failure when createTaskForPR fails', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(err({
        code: 'user_not_found' as const,
        message: 'No user found for GitHub username',
      }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: false,
        dispatched: false,
        error: 'No user found for GitHub username',
      });
    });

    it('should return failure when userLookupService is not configured', async () => {
      deps = createMockDeps();
      delete (deps as unknown as Record<string, unknown>)['userLookupService'];
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: false,
        dispatched: false,
        error: 'UserLookupService not configured',
      });
    });

    it('should omit prTitle when event.title is null', async () => {
      const nullTitleEvent = { ...mockEvent, title: null };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-abc' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullTitleEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('prTitle');
    });

    it('should resolve bot senderLogin to repo owner for task creation', async () => {
      const botEvent = { ...mockEvent, senderLogin: 'claude[bot]', repository: 'pbuchman/intexuraos' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-bot' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: botEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('pbuchman');
    });

    it('should fall back to bot username when repository has no slash', async () => {
      const botEvent = { ...mockEvent, senderLogin: 'claude[bot]', repository: 'intexuraos' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-fallback' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: botEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('claude[bot]');
    });

    it('should not remap bot senderLogin for org-owned repos', async () => {
      const botEvent = { ...mockEvent, senderLogin: 'claude[bot]', repository: 'intexuraos/api-gateway' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-org' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: botEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('claude[bot]');
    });

    it('should not resolve non-bot senderLogin', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-human' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('test-sender');
    });

    it('should use empty string for comment when body is null', async () => {
      const nullBodyEvent = { ...mockEvent, body: null };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-abc' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullBodyEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.comment).toBe('');
    });

    it('should resolve baseBranch from stored PR events when event.baseBranch is null', async () => {
      const nullBranchEvent = { ...mockEvent, baseBranch: null };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.gitHubPREventRepo.findByPullRequest).mockResolvedValue(ok([
        { ...mockEvent, baseBranch: 'development' },
      ]));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-resolved' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullBranchEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.baseBranch).toBe('development');
    });

    it('should pass baseBranch directly when event.baseBranch is set', async () => {
      const branchEvent = { ...mockEvent, baseBranch: 'feature-branch' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-direct' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: branchEvent });

      expect(deps.gitHubPREventRepo.findByPullRequest).not.toHaveBeenCalled();
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.baseBranch).toBe('feature-branch');
    });

    it('should omit baseBranch when findByPullRequest fails', async () => {
      const nullBranchEvent = { ...mockEvent, baseBranch: null };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.gitHubPREventRepo.findByPullRequest).mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
      );
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-err' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullBranchEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('baseBranch');
    });

    it('should omit baseBranch when lookup finds no events with baseBranch', async () => {
      const nullBranchEvent = { ...mockEvent, baseBranch: null };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.gitHubPREventRepo.findByPullRequest).mockResolvedValue(ok([]));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-no-branch' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullBranchEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('baseBranch');
    });

    it('should extract workerType from @worker directive in comment', async () => {
      const workerCommentEvent = { ...mockEvent, body: 'Fix this @worker minimax' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-worker' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: workerCommentEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.workerType).toBe('minimax');
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ workerType: 'minimax', prNumber: 42 }),
        'Extracted worker type from comment'
      );
    });

    it('should extract workerType from @model directive in comment', async () => {
      const modelCommentEvent = { ...mockEvent, body: '@model qwen fix the tests' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-model' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: modelCommentEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.workerType).toBe('qwen');
    });

    it('should not pass workerType when no @worker/@model directive found', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-no-worker' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });

    it('should not pass workerType when directive has unknown type', async () => {
      const unknownTypeEvent = { ...mockEvent, body: '@worker unknown-model' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-unknown' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: unknownTypeEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });
  });

  describe('dispatch — error handling', () => {
    it('should return failure when findByPR fails', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
      );

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: false,
        dispatched: false,
        error: 'Failed to find task: Firestore unavailable',
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 42, repo: 'test-owner/test-repo' }),
        'Failed to find task for PR'
      );
    });

    it('should catch unexpected errors and return failure', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockRejectedValue(new Error('Connection reset'));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: false,
        dispatched: false,
        error: 'Unexpected error: Connection reset',
      });
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 42, repo: 'test-owner/test-repo', error: 'Connection reset' }),
        'Unexpected error in dispatch workflow'
      );
    });
  });

  describe('dispatch — retry queue for existing task message failure', () => {
    it('queues retry when sendTaskMessage fails with retryable error and dispatchRetryRepo is available', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(
        err({ code: 'worker_unavailable' as const, message: 'Worker timed out' })
      );

      const mockCreate = vi.fn().mockResolvedValue(ok({} as never));
      deps = createMockDeps({
        dispatchRetryRepo: {
          create: mockCreate,
          findOldest: vi.fn(),
          delete: vi.fn(),
          update: vi.fn(),
        } as never,
      });
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(existingTask as never));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-123',
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_message',
          taskId: 'task-123',
          userId: 'user-456',
          lastError: 'Worker timed out',
        })
      );
    });
  });

  describe('dispatch — logging', () => {
    it('should log dispatch workflow start', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      deps = createMockDeps();
      delete (deps as unknown as Record<string, unknown>)['userLookupService'];
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { prNumber: 42, repo: 'test-owner/test-repo', action: 'opened' },
        'Starting GitHub dispatch workflow'
      );
    });

    it('should log when new task is created', async () => {
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'new-task' }),
        'Created and dispatched new task from webhook'
      );
    });

    it('should log when message is sent to existing task', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123', action: 'queued' }),
        'Dispatched webhook event to existing task'
      );
    });
  });
});
