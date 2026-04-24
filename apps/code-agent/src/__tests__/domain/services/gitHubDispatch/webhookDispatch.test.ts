import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import { executeWebhookDispatch } from '../../../../domain/services/gitHubDispatch/webhookDispatch.js';
import type { DispatchContext, WebhookDispatchServiceDeps } from '../../../../domain/services/gitHubDispatch/types.js';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import type { RuleOutcome } from '../../../../domain/services/gitHubWebhookRules.js';

vi.mock('../../../../domain/usecases/createTaskForPR.js', () => ({
  createTaskForPR: vi.fn(),
}));
vi.mock('../../../../domain/usecases/sendTaskMessage.js', () => ({
  sendTaskMessage: vi.fn(),
}));

import { createTaskForPR } from '../../../../domain/usecases/createTaskForPR.js';
import { sendTaskMessage } from '../../../../domain/usecases/sendTaskMessage.js';

const mockedCreateTaskForPR = vi.mocked(createTaskForPR);
const mockedSendTaskMessage = vi.mocked(sendTaskMessage);

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

  it('returns failure when findLatestExecutionTaskByPR fails', async () => {
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(
      err({ code: 'x' as never, message: 'db down' }),
    );

    const result = await executeWebhookDispatch(deps, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to find task: db down');
  });

  it('routes to new-task when no existing task is found', async () => {
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-new' } as never));

    const result = await executeWebhookDispatch(deps, context);

    expect(result).toEqual({ success: true, dispatched: true, taskId: 'task-new' });
    expect(mockedCreateTaskForPR).toHaveBeenCalled();
  });

  it('creates a new task when PR is closed even if existing task is found', async () => {
    const existingTask = { id: 'task-stale', userId: 'user-1' };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-fresh' } as never));

    const closedEvent: GitHubPREvent = { ...baseEvent, state: 'closed' };
    const result = await executeWebhookDispatch(deps, { event: closedEvent, decision, logger: mockLogger });

    expect(result.taskId).toBe('task-fresh');
    expect(mockedSendTaskMessage).not.toHaveBeenCalled();
  });

  it('creates a new task when PR is merged', async () => {
    const existingTask = { id: 'task-stale', userId: 'user-1' };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-fresh' } as never));

    const mergedEvent: GitHubPREvent = { ...baseEvent, mergedAt: new Date('2026-03-04T00:00:00Z') };
    const result = await executeWebhookDispatch(deps, { event: mergedEvent, decision, logger: mockLogger });

    expect(result.taskId).toBe('task-fresh');
  });

  it('falls back to new task when existing task is stale (worker 404)', async () => {
    const existingTask = { id: 'task-stale', userId: 'user-1' };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(existingTask as never));
    mockedSendTaskMessage.mockResolvedValue(
      err({ code: 'task_not_found' as never, message: 'gone' }),
    );
    mockedCreateTaskForPR.mockResolvedValue(ok({ taskId: 'task-fresh' } as never));

    const result = await executeWebhookDispatch(deps, context);

    expect(result).toEqual({ success: true, dispatched: true, taskId: 'task-fresh' });
  });

  it('wraps unexpected errors from task lookup', async () => {
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockRejectedValue(new Error('kaboom'));

    const result = await executeWebhookDispatch(deps, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unexpected error: kaboom');
  });

  it('returns error when userLookupService is not configured for new tasks', async () => {
    const depsWithoutUserLookup = makeDeps();
    // Force explicit undefined via destructure to bypass optional check
    const withUndef: WebhookDispatchServiceDeps = { ...depsWithoutUserLookup };
    delete (withUndef as { userLookupService?: unknown }).userLookupService;

    const result = await executeWebhookDispatch(withUndef, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe('UserLookupService not configured');
  });
});
