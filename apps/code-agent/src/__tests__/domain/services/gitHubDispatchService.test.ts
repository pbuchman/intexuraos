import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import { createWebhookDispatchService, isStaleTaskError } from '../../../domain/services/gitHubDispatchService.js';
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
  prAuthorLogin: null,
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
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findPreservedPullRequestTask: vi.fn().mockResolvedValue(ok(null)),
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
      listQueuedByAge: vi.fn(),
      listQueued: vi.fn(),
      countQueued: vi.fn(),
    } as never,
    logLineRepo: {} as never,
    userLookupService: {} as never,
    linearIssueService: {} as never,
    taskDispatcher: {} as never,
    taskEnqueueService: {} as never,
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
    automationLog: { record: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

// Creates a deps object with properly typed mocks for dispatchCIFailure tests
function createMockDepsForCIFailure(): WebhookDispatchServiceDeps {
  return {
    ...createMockDeps(),
    codeTaskRepo: {
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findPreservedPullRequestTask: vi.fn().mockResolvedValue(ok(null)),
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
      listQueuedByAge: vi.fn(),
      listQueued: vi.fn(),
      countQueued: vi.fn(),
    } as never,
    automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
    taskEnqueueService: {
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as never,
    whatsappNotifier: {
      notifyCIFailure: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    } as never,
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
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
      expect(deps.automationLog.record).toHaveBeenCalledWith(
        { repository: 'test-owner/test-repo', prNumber: 42 },
        expect.objectContaining({ type: 'task_dispatched', taskId: 'task-123', agentType: 'pull_request' }),
        'user-456',
      );
    });

    it('should record automation log when existing task is resumed', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456', linearIssueId: 'INT-100' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'resumed' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-123',
      });
      expect(deps.automationLog.record).toHaveBeenCalledWith(
        { repository: 'test-owner/test-repo', prNumber: 42 },
        expect.objectContaining({ type: 'task_dispatched', taskId: 'task-123', agentType: 'pull_request' }),
        'user-456',
      );
    });

    it('should return failure when sendTaskMessage fails', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(err({ code: 'worker_error' as const, message: 'Worker timeout' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: false,
        dispatched: false,
        taskId: 'task-123',
        error: 'Worker timeout',
        errorCode: 'worker_error',
      });
      expect(vi.mocked(deps.gitHubPRClient.postPRComment)).not.toHaveBeenCalled();
    });

    it('should keep dispatch successful when PR comment posting fails', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456', linearIssueId: 'INT-100' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
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

    it('should fall back to new task when worker returns "Task not found" for stale task', async () => {
      const staleTask = { id: 'stale-task', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(staleTask as never));
      mockedSendTaskMessage.mockResolvedValue(err({ code: 'worker_error' as const, message: 'Task not found' }));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-fallback' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-fallback',
      });
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ staleTaskId: 'stale-task', prNumber: 42 }),
        'Existing task is stale on worker, falling back to new task creation'
      );
    });

    it('should fall back to new task when sendTaskMessage returns task_not_found code', async () => {
      const staleTask = { id: 'stale-task', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(staleTask as never));
      mockedSendTaskMessage.mockResolvedValue(err({ code: 'task_not_found' as const, message: 'Task stale-task not found' }));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-fallback-2' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-fallback-2',
      });
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
    });

    it('should not fall back to new task when worker fails with a different error', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(err({ code: 'worker_error' as const, message: 'Worker timeout' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: false,
        dispatched: false,
        taskId: 'task-123',
        error: 'Worker timeout',
        errorCode: 'worker_error',
      });
      expect(mockedCreateTaskForPR).not.toHaveBeenCalled();
    });

    it('should not fall back when handleExistingTask fails without error message', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(err({ code: 'internal_error' as const, message: '' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result.success).toBe(false);
      expect(mockedCreateTaskForPR).not.toHaveBeenCalled();
    });

    it('should not fall back when existing task succeeds', async () => {
      const existingTask = { id: 'task-123', userId: 'user-456', linearIssueId: 'INT-100' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-123',
      });
      expect(mockedCreateTaskForPR).not.toHaveBeenCalled();
    });
  });

  describe('dispatch — new task path', () => {
    it('should create task via createTaskForPR when no task exists', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));

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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-abc' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullTitleEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('prTitle');
    });

    it('should resolve bot senderLogin to repo owner for task creation', async () => {
      const botEvent = { ...mockEvent, senderLogin: 'claude[bot]', repository: 'pbuchman/intexuraos' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-bot' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: botEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('pbuchman');
    });

    it('should fall back to bot username when repository has no slash', async () => {
      const botEvent = { ...mockEvent, senderLogin: 'claude[bot]', repository: 'intexuraos' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-fallback' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: botEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('claude[bot]');
    });

    it('should not remap bot senderLogin for org-owned repos', async () => {
      const botEvent = { ...mockEvent, senderLogin: 'claude[bot]', repository: 'intexuraos/api-gateway' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-org' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: botEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('claude[bot]');
    });

    it('should not resolve non-bot senderLogin', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-human' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.senderLogin).toBe('test-sender');
    });

    it('should use empty string for comment when body is null', async () => {
      const nullBodyEvent = { ...mockEvent, body: null };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-abc' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullBodyEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.comment).toBe('');
    });

    it('should resolve baseBranch from stored PR events when event.baseBranch is null', async () => {
      const nullBranchEvent = { ...mockEvent, baseBranch: null };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-direct' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: branchEvent });

      expect(deps.gitHubPREventRepo.findByPullRequest).not.toHaveBeenCalled();
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.baseBranch).toBe('feature-branch');
    });

    it('should omit baseBranch when findByPullRequest fails', async () => {
      const nullBranchEvent = { ...mockEvent, baseBranch: null };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.gitHubPREventRepo.findByPullRequest).mockResolvedValue(ok([]));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-no-branch' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: nullBranchEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('baseBranch');
    });

    it('should route @worker directive to createTaskForPR with workerType', async () => {
      const workerCommentEvent = { ...mockEvent, body: 'Fix this @worker minimax' };
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-worker-minimax' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch({ ...context, event: workerCommentEvent });

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-worker-minimax');
      expect(mockedCreateTaskForPR).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ workerType: 'minimax', prNumber: 42 }),
      );
    });

    it('should ignore @model directive (not recognized)', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-no-branch' }));
      const modelCommentEvent = { ...mockEvent, body: '@model qwen fix the tests' };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch({ ...context, event: modelCommentEvent });

      expect(result.success).toBe(true);
      // @model is not recognized, so it should not be treated as a remediation directive
      // Instead it falls through to normal task creation without workerType
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });

    it('should not pass workerType when no @worker/@model directive found', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-no-worker' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });

    it('should not pass workerType when directive has unknown type', async () => {
      const unknownTypeEvent = { ...mockEvent, body: '@worker unknown-model' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-unknown' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: unknownTypeEvent });

      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });
  });

  describe('dispatch — pull_request_review in new task path', () => {
    it.each([
      { sender: 'intexuraos-code-worker[bot]', label: 'code-worker' },
      { sender: 'test-sender', label: 'human' },
    ])('should use messageBuilder for $label review events', async ({ sender }) => {
      const reviewEvent: GitHubPREvent = {
        ...mockEvent,
        eventType: 'pull_request_review',
        action: 'submitted',
        senderLogin: sender,
        body: 'Review feedback',
      };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-review-new' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch({ ...context, event: reviewEvent });

      expect(deps.messageBuilder.build).toHaveBeenCalledWith(reviewEvent);
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.comment).toBe('built-message');
    });

    it('should not use messageBuilder for non-review events', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-pr' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      expect(deps.messageBuilder.build).not.toHaveBeenCalled();
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg?.comment).toBe('Test description');
    });

    it('should route pull_request_review with @worker directive to createTaskForPR with workerType', async () => {
      const reviewEvent: GitHubPREvent = {
        ...mockEvent,
        eventType: 'pull_request_review',
        action: 'submitted',
        body: 'Fix this @worker minimax',
      };
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-review-worker-minimax' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch({ ...context, event: reviewEvent });

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-review-worker-minimax');
      expect(mockedCreateTaskForPR).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ workerType: 'minimax' }),
      );
    });
  });

  describe('dispatch — remediation routing (INT-1087)', () => {
    it('should NOT route CODE_WORKER_REVIEW to @worker directive path', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-new' }));

      const codeWorkerContext: DispatchContext = {
        event: { ...mockEvent, eventType: 'pull_request_review', action: 'submitted', senderLogin: 'claude[bot]', body: 'Review findings: 3 issues found' },
        decision: { action: 'dispatch', reason: 'CODE_WORKER_REVIEW' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(codeWorkerContext);

      expect(result.success).toBe(true);
      // No @worker directive in the body, so workerType should not be passed
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });

    it('should route @worker directive comments to createTaskForPR with workerType', async () => {
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-worker-2' }));

      const workerContext: DispatchContext = {
        event: { ...mockEvent, body: 'Fix the review findings @worker opus' },
        decision: { action: 'dispatch', reason: 'ALL_RULES_PASSED' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(workerContext);

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-worker-2');
      expect(mockedCreateTaskForPR).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ workerType: 'opus' }),
      );
    });

    it('should ignore @model directive in comments (not recognized)', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-new' }));

      const modelContext: DispatchContext = {
        event: { ...mockEvent, body: '@model sonnet fix the tests' },
        decision: { action: 'dispatch', reason: 'ALL_RULES_PASSED' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(modelContext);

      expect(result.success).toBe(true);
      // @model is not recognized, so workerType should not be passed
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });

    it('should pass workerType to createTaskForPR when @worker event has baseBranch', async () => {
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-worker-branch' }));

      const workerContext: DispatchContext = {
        event: {
          ...mockEvent,
          body: '@worker opus fix the formatting',
          baseBranch: 'development',
        },
        decision: { action: 'dispatch', reason: 'ALL_RULES_PASSED' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(workerContext);

      expect(result.success).toBe(true);
      expect(mockedCreateTaskForPR).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          workerType: 'opus',
          baseBranch: 'development',
        }),
      );
    });

    it('should fall through to normal dispatch when no @worker/@model and not code-worker review', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-normal' }));

      const normalContext: DispatchContext = {
        event: { ...mockEvent, body: 'Fix the login bug' },
        decision: { action: 'dispatch', reason: 'ALL_RULES_PASSED' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(normalContext);

      expect(result.success).toBe(true);
      const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
      expect(requestArg).not.toHaveProperty('workerType');
    });

    it('should return failure when createTaskForPR fails for @worker directive', async () => {
      mockedCreateTaskForPR.mockResolvedValue(err({ code: 'task_creation_failed' as const, message: 'Firestore error' }));

      const workerContext: DispatchContext = {
        event: { ...mockEvent, body: '@worker opus fix it' },
        decision: { action: 'dispatch', reason: 'ALL_RULES_PASSED' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(workerContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Firestore error');
    });

    it('@worker opus comment creates pull_request task with workerType opus', async () => {
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-worker-opus' }));

      const workerContext: DispatchContext = {
        event: { ...mockEvent, body: '@worker opus fix it' },
        decision: { action: 'dispatch', reason: 'ALL_RULES_PASSED' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(workerContext);

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-worker-opus');
      expect(mockedCreateTaskForPR).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          workerType: 'opus',
          prNumber: 42,
        }),
      );
    });

    it('sends message to existing executing task even when @worker directive is present', async () => {
      // The dispatch flow checks for an existing executing task BEFORE processing @worker.
      // If one exists, the @worker directive is intentionally ignored — the comment is
      // forwarded as a message to the running task rather than creating a competing one.
      const existingTask = { id: 'task-running', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

      const workerContext: DispatchContext = {
        event: { ...mockEvent, body: '@worker opus fix it' },
        decision: { action: 'dispatch', reason: 'ALL_RULES_PASSED' },
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(workerContext);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-running',
      });
      expect(mockedSendTaskMessage).toHaveBeenCalledWith(
        expect.objectContaining({ logger: mockLogger }),
        { taskId: 'task-running', userId: 'user-456', message: 'built-message' },
      );
      expect(mockedCreateTaskForPR).not.toHaveBeenCalled();
    });
  });

  describe('dispatch — error handling', () => {
    it('should return failure when findByPR fails', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockRejectedValue(new Error('Connection reset'));

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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));

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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      deps = createMockDeps();
      delete (deps as unknown as Record<string, unknown>)['userLookupService'];
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        { prNumber: 42, repo: 'test-owner/test-repo', action: 'opened' },
        'Starting GitHub dispatch workflow'
      );
    });

    it('should log when new task is created', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
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
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task-123', action: 'queued' }),
        'Dispatched webhook event to existing task'
      );
    });
  });

  describe('dispatch — non-review task routing for generic comments', () => {
    it('should use findLatestExecutionTaskByPR to find existing non-review task', async () => {
      const nonReviewTask = { id: 'task-nonreview', userId: 'user-456', linearIssueId: 'INT-100' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(nonReviewTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'queued' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'task-nonreview',
      });
      expect(deps.codeTaskRepo.findLatestExecutionTaskByPR).toHaveBeenCalledWith(
        'test-owner/test-repo',
        42
      );
    });

    it('should ignore review tasks when routing generic comments', async () => {
      // findLatestExecutionTaskByPR returns null (no non-review tasks)
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-789' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      // Should create a new pull_request task
      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-789',
      });
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
    });

    it('should never call sendTaskMessage on review tasks', async () => {
      // findLatestExecutionTaskByPR returns null even though review tasks exist
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task' }));

      const service = createWebhookDispatchService(deps);
      await service.dispatch(context);

      // sendTaskMessage should not be called with review task
      expect(mockedSendTaskMessage).not.toHaveBeenCalled();
    });

    it('should resume non-review task when review task also exists', async () => {
      // Non-review task exists
      const nonReviewTask = { id: 'task-nonreview', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(nonReviewTask as never));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'resumed' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result.taskId).toBe('task-nonreview');
      expect(mockedSendTaskMessage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ taskId: 'task-nonreview' })
      );
    });
  });

  describe('dispatch — preserved container reuse', () => {
    it('sends message to preserved container for non-@worker comment', async () => {
      const preserved = { id: 'task-preserved', workerLocation: 'vm-1', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.codeTaskRepo.findPreservedPullRequestTask).mockResolvedValue(ok(preserved));
      mockedSendTaskMessage.mockResolvedValue(ok({ action: 'resumed' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
      });
      expect(mockedSendTaskMessage).toHaveBeenCalledWith(
        expect.objectContaining({ logger: mockLogger }),
        { taskId: 'task-preserved', userId: 'user-456', message: 'Test description' },
      );
      expect(mockedCreateTaskForPR).not.toHaveBeenCalled();
    });

    it('falls through to createTaskForPR when sendTaskMessage fails', async () => {
      const preserved = { id: 'task-preserved', workerLocation: 'vm-1', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.codeTaskRepo.findPreservedPullRequestTask).mockResolvedValue(ok(preserved));
      mockedSendTaskMessage.mockResolvedValue(err({ code: 'worker_error' as const, message: 'Container gone' }));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-fallback' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-fallback',
      });
      expect(mockedSendTaskMessage).toHaveBeenCalled();
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
    });

    it('falls through to createTaskForPR when sendTaskMessage throws', async () => {
      const preserved = { id: 'task-preserved', workerLocation: 'vm-1', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.codeTaskRepo.findPreservedPullRequestTask).mockResolvedValue(ok(preserved));
      mockedSendTaskMessage.mockRejectedValue(new Error('Network failure'));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-thrown' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-thrown',
      });
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
    });

    it('skips preserved container reuse when @worker directive is present', async () => {
      const preserved = { id: 'task-preserved', workerLocation: 'vm-1', userId: 'user-456' };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.codeTaskRepo.findPreservedPullRequestTask).mockResolvedValue(ok(preserved));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-worker-task' }));

      const workerContext: DispatchContext = {
        event: { ...mockEvent, body: '@worker opus fix it' },
        decision: mockDecision,
        logger: mockLogger,
      };

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(workerContext);

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('new-worker-task');
      // Should NOT attempt to reuse preserved container when @worker is present
      expect(deps.codeTaskRepo.findPreservedPullRequestTask).not.toHaveBeenCalled();
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
    });

    it('falls through to createTaskForPR when no preserved container exists', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.codeTaskRepo.findPreservedPullRequestTask).mockResolvedValue(ok(null));
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-no-preserved' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-no-preserved',
      });
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
    });

    it('falls through to createTaskForPR when findPreservedPullRequestTask returns error', async () => {
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));
      vi.mocked(deps.codeTaskRepo.findPreservedPullRequestTask).mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'DB error' })
      );
      mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'new-task-db-err' }));

      const service = createWebhookDispatchService(deps);
      const result = await service.dispatch(context);

      expect(result).toEqual<WebhookDispatchResult>({
        success: true,
        dispatched: true,
        taskId: 'new-task-db-err',
      });
      expect(mockedCreateTaskForPR).toHaveBeenCalled();
    });
  });

  describe('isStaleTaskError', () => {
    it('should return true for task_not_found error code', () => {
      expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'task_not_found', error: 'Task X not found' })).toBe(true);
    });

    it('should return true for task_not_found regardless of message content', () => {
      expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'task_not_found', error: 'anything' })).toBe(true);
    });

    it('should return true for worker_error with "Task not found" message', () => {
      expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'worker_error', error: 'Task not found' })).toBe(true);
    });

    it('should return true for worker_error with "HTTP 404" message', () => {
      expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'worker_error', error: 'Worker returned HTTP 404' })).toBe(true);
    });

    it('should return false for worker_error with unrelated message', () => {
      expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'worker_error', error: 'Worker timeout' })).toBe(false);
    });

    it('should return false for other error codes', () => {
      expect(isStaleTaskError({ success: false, dispatched: false, errorCode: 'internal_error', error: 'not found' })).toBe(false);
    });

    it('should return false when no error code is set', () => {
      expect(isStaleTaskError({ success: false, dispatched: false, error: 'Task not found' })).toBe(false);
    });

    it('should return false for successful results', () => {
      expect(isStaleTaskError({ success: true, dispatched: true })).toBe(false);
    });
  });

  describe('dispatchCIFailure', () => {
    function createMockEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
      return {
        id: 'event-cifailure-123',
        githubEventId: 456,
        deliveryId: null,
        repository: 'test-owner/test-repo',
        repositoryId: 54321,
        pullRequestNumber: 42,
        pullRequestId: 12345,
        eventType: 'check_suite',
        action: 'completed',
        senderLogin: 'test-sender',
        senderId: 999,
        senderType: 'User',
        prAuthorLogin: null,
        title: 'CI Check Failed',
        body: null,
        state: 'open',
        baseBranch: 'task_abc123',
        mergedAt: null,
        createdAt: new Date('2026-03-03T10:00:00Z'),
        processedAt: new Date('2026-03-03T10:00:00Z'),
        payload: {},
        ...overrides,
      };
    }

    it('should skip when no original task is found', async () => {
      const deps = createMockDepsForCIFailure();
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null as never));

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent();
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('no_original_task');
      expect(result.fixTaskCreated).toBe(false);
    });

    it('should skip when original task is already a CI failure follow-up', async () => {
      const deps = createMockDepsForCIFailure();
      const existingTask = {
        id: 'task_existing',
        userId: 'user-123',
        followUpReason: 'ci_failure' as const,
        workerType: 'opus' as const,
        workerLocation: 'cloud' as const,
      };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent();
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('already_follow_up');
      expect(result.fixTaskCreated).toBe(false);
    });

    it('should return error when findLatestExecutionTaskByPR fails', async () => {
      const deps = createMockDepsForCIFailure();
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(
        err({ code: 'INTERNAL_ERROR', message: 'Database unavailable' } as never)
      );

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent();
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(false);
      expect(result.fixTaskCreated).toBe(false);
      expect(result.error).toContain('Failed to find task');
    });

    it('should create fix task and return success when original task found', async () => {
      const deps = createMockDepsForCIFailure();
      const existingTask = {
        id: 'task_original',
        userId: 'user-123',
        followUpReason: undefined as string | undefined,
        workerType: 'opus' as const,
        workerLocation: 'cloud' as const,
        baseBranch: 'main',
      };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(ok({ id: 'task_fix123' } as never));

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent({
        payload: {
          checkName: 'ESLint',
          headSha: 'abc123',
          checkSuiteId: 789,
        },
      });
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(true);
      expect(result.fixTaskCreated).toBe(true);
      expect(result.fixTaskId).toBe('task_fix123');
      expect(result.skipped).toBeUndefined();
    });

    it('should return error when task creation fails', async () => {
      const deps = createMockDepsForCIFailure();
      const existingTask = {
        id: 'task_original',
        userId: 'user-123',
        followUpReason: undefined as string | undefined,
        workerType: 'opus' as const,
        workerLocation: 'cloud' as const,
        baseBranch: 'main',
      };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(
        err({ code: 'INTERNAL_ERROR', message: 'Failed to create task' } as never)
      );

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent();
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(false);
      expect(result.fixTaskCreated).toBe(false);
      expect(result.error).toContain('Failed to create task');
    });

    it('should handle event without payload gracefully', async () => {
      const deps = createMockDepsForCIFailure();
      const existingTask = {
        id: 'task_original',
        userId: 'user-123',
        followUpReason: undefined as string | undefined,
        workerType: 'opus' as const,
        workerLocation: 'cloud' as const,
        baseBranch: 'main',
      };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(ok({ id: 'task_fix456' } as never));

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent({ payload: null });
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(true);
      expect(result.fixTaskCreated).toBe(true);
      expect(result.fixTaskId).toBe('task_fix456');
    });

    it('should use baseBranch fallback when event.baseBranch is null', async () => {
      const deps = createMockDepsForCIFailure();
      const existingTask = {
        id: 'task_original',
        userId: 'user-123',
        followUpReason: undefined as string | undefined,
        workerType: 'opus' as const,
        workerLocation: 'cloud' as const,
        baseBranch: 'main',
      };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(ok({ id: 'task_fix789' } as never));

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent({ baseBranch: null });
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(true);
      expect(result.fixTaskCreated).toBe(true);
    });

    it('should include linearIssueId in fix task when original task has it', async () => {
      const deps = createMockDepsForCIFailure();
      const existingTask = {
        id: 'task_original',
        userId: 'user-123',
        followUpReason: undefined as string | undefined,
        workerType: 'opus' as const,
        workerLocation: 'cloud' as const,
        baseBranch: 'main',
        linearIssueId: 'INT-123',
      };
      vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
      vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(ok({ id: 'task_fix789' } as never));

      const service = createWebhookDispatchService(deps);
      const event = createMockEvent();
      const result = await service.dispatchCIFailure({ event, logger: mockLogger });

      expect(result.success).toBe(true);
      expect(result.fixTaskCreated).toBe(true);

      // Verify create was called with linearIssueId
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
      expect(createCall).toHaveProperty('linearIssueId', 'INT-123');
    });
  });
});
