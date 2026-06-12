import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ok, type Logger } from '@intexuraos/common-core';
import { executeWebhookDispatch } from '../../../../domain/services/gitHubDispatch/webhookDispatch.js';
import type { DispatchContext, WebhookDispatchServiceDeps } from '../../../../domain/services/gitHubDispatch/types.js';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import type { RuleOutcome } from '../../../../domain/services/gitHubWebhookRules.js';

vi.mock('../../../../domain/usecases/createTaskForPR.js', () => ({
  createTaskForPR: vi.fn(),
}));

import { createTaskForPR } from '../../../../domain/usecases/createTaskForPR.js';

const mockedCreateTaskForPR = vi.mocked(createTaskForPR);

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const baseEvent: GitHubPREvent = {
  id: 'event-123',
  githubEventId: 123,
  deliveryId: null,
  repository: 'alice/intexuraos',
  repositoryId: 54321,
  pullRequestNumber: 42,
  pullRequestId: 12345,
  eventType: 'pull_request',
  action: 'opened',
  senderLogin: 'alice',
  senderId: 999,
  senderType: 'User',
  prAuthorLogin: null,
  title: 'Test PR',
  body: 'body',
  state: 'open',
  isDraft: null,
  baseBranch: 'main',
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {},
};

const decision: RuleOutcome = { action: 'dispatch', reason: 'ALL_RULES_PASSED' };

function makeDeps(overrides: Partial<WebhookDispatchServiceDeps> = {}): WebhookDispatchServiceDeps {
  return {
    gitHubPREventRepo: {
      findByPullRequest: vi.fn().mockResolvedValue(ok([])),
    } as never,
    codeTaskRepo: {
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findPreservedPullRequestTask: vi.fn().mockResolvedValue(ok(null)),
    } as never,
    logLineRepo: {} as never,
    userLookupService: {} as never,
    linearIssueService: {} as never,
    taskDispatcher: {} as never,
    taskEnqueueService: {} as never,
    whatsappNotifier: {} as never,
    workerSettingsRepo: {} as never,
    statusMirrorService: {} as never,
    gitHubPRClient: {} as never,
    userServiceClient: {} as never,
    firestore: {} as never,
    messageBuilder: {
      build: vi.fn().mockReturnValue('built-message'),
    } as never,
    allowedBots: new Set(),
    orchestratorSecret: 'secret',
    serviceUrl: 'http://localhost',
    automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
    ...overrides,
  };
}

describe('executeWebhookDispatch', () => {
  let deps: WebhookDispatchServiceDeps;
  let context: DispatchContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
    context = { event: baseEvent, decision, logger: mockLogger };
  });

  it('creates a new task when no prior task exists for the PR', async () => {
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-new' } as never));

    const result = await executeWebhookDispatch(deps, context);

    expect(result).toEqual({ success: true, dispatched: true, taskId: 'task-new' });
    expect(mockedCreateTaskForPR).toHaveBeenCalled();
  });

  it('wraps unexpected errors thrown from inside handleNewTask', async () => {
    vi.mocked(deps.codeTaskRepo.findPreservedPullRequestTask).mockRejectedValue(new Error('kaboom'));

    const result = await executeWebhookDispatch(deps, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unexpected error: kaboom');
  });

  it('returns error when userLookupService is not configured for new tasks', async () => {
    const depsWithoutUserLookup = makeDeps();
    const withUndef: WebhookDispatchServiceDeps = { ...depsWithoutUserLookup };
    delete (withUndef as { userLookupService?: unknown }).userLookupService;

    const result = await executeWebhookDispatch(withUndef, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe('UserLookupService not configured');
  });

  it('creates a fresh task on pull_request_review even when a prior execution task exists for the same PR', async () => {
    const seededExecutionTask = { id: 'task_e3973762-1d5f-46d1-843f-340ab60312d5', userId: 'user-1' };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(seededExecutionTask as never));
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-fresh-pr' } as never));

    const reviewEvent: GitHubPREvent = {
      ...baseEvent,
      eventType: 'pull_request_review',
      action: 'submitted',
      state: 'open',
      mergedAt: null,
    };
    const result = await executeWebhookDispatch(deps, { event: reviewEvent, decision, logger: mockLogger });

    expect(result).toEqual({ success: true, dispatched: true, taskId: 'task-fresh-pr' });
    expect(mockedCreateTaskForPR).toHaveBeenCalled();
  });

  it('creates a new task on issue_comment without @worker mention', async () => {
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-issue-comment' } as never));

    const issueCommentEvent: GitHubPREvent = {
      ...baseEvent,
      eventType: 'issue_comment',
      action: 'created',
      body: 'looks great',
    };
    const result = await executeWebhookDispatch(deps, { event: issueCommentEvent, decision, logger: mockLogger });

    expect(result).toEqual({ success: true, dispatched: true, taskId: 'task-issue-comment' });
    const requestArg = mockedCreateTaskForPR.mock.calls[0]?.[1];
    expect(requestArg).not.toHaveProperty('workerType');
  });

  it('forwards workerType when issue_comment carries an @worker mention', async () => {
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-issue-glm' } as never));

    const workerCommentEvent: GitHubPREvent = {
      ...baseEvent,
      eventType: 'issue_comment',
      action: 'created',
      body: '@worker glm please retry',
    };
    const result = await executeWebhookDispatch(deps, { event: workerCommentEvent, decision, logger: mockLogger });

    expect(result).toEqual({ success: true, dispatched: true, taskId: 'task-issue-glm' });
    expect(mockedCreateTaskForPR).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ workerType: 'glm' }),
    );
  });

  it('creates a new task on pull_request_review_comment (inline diff comment)', async () => {
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-inline-comment' } as never));

    const inlineCommentEvent: GitHubPREvent = {
      ...baseEvent,
      eventType: 'pull_request_review_comment',
      action: 'created',
      body: 'consider extracting this',
    };
    const result = await executeWebhookDispatch(deps, { event: inlineCommentEvent, decision, logger: mockLogger });

    expect(result).toEqual({ success: true, dispatched: true, taskId: 'task-inline-comment' });
    expect(mockedCreateTaskForPR).toHaveBeenCalled();
  });
});
