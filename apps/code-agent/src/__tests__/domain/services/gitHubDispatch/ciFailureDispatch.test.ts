import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import {
  ciFixPrompt,
  executeCIFailureDispatch,
} from '../../../../domain/services/gitHubDispatch/ciFailureDispatch.js';
import type { WebhookDispatchServiceDeps } from '../../../../domain/services/gitHubDispatch/types.js';
import type { GitHubPREvent } from '../../../../domain/models/gitHubPREvent.js';
import { generateWebhookSecret } from '../../../../domain/utils/secrets.js';

const mockLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const baseEvent: GitHubPREvent = {
  id: 'event-ci-1',
  githubEventId: 456,
  deliveryId: null,
  repository: 'alice/intexuraos',
  repositoryId: 54321,
  pullRequestNumber: 42,
  pullRequestId: 12345,
  eventType: 'check_suite',
  action: 'completed',
  senderLogin: 'github-actions[bot]',
  senderId: 1,
  senderType: 'Bot',
  prAuthorLogin: null,
  title: null,
  body: null,
  state: 'open',
  isDraft: null,
  baseBranch: 'main',
  mergedAt: null,
  createdAt: new Date('2026-03-03T10:00:00Z'),
  processedAt: new Date('2026-03-03T10:00:00Z'),
  payload: {
    checkName: 'build',
    headSha: 'abc123',
    checkSuiteId: 555,
    checkSuiteUrl: 'https://github.com/alice/intexuraos/runs/555',
  },
};

function makeDeps(overrides: Partial<WebhookDispatchServiceDeps> = {}): WebhookDispatchServiceDeps {
  return {
    gitHubPREventRepo: {} as never,
    codeTaskRepo: {
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      create: vi.fn(),
    } as never,
    logLineRepo: {} as never,
    userLookupService: {} as never,
    linearIssueService: {} as never,
    taskDispatcher: {} as never,
    taskEnqueueService: {
      enqueue: vi.fn().mockResolvedValue(undefined),
    } as never,
    whatsappNotifier: {
      notifyCIFailure: vi.fn().mockResolvedValue(undefined),
    } as never,
    workerSettingsRepo: {} as never,
    gitHubPRClient: {} as never,
    userServiceClient: {} as never,
    firestore: {} as never,
    messageBuilder: { build: vi.fn() } as never,
    allowedBots: new Set(),
    orchestratorSecret: 'secret',
    serviceUrl: 'http://localhost',
    automationLog: { record: vi.fn().mockResolvedValue(undefined) } as never,
    ...overrides,
  };
}

describe('ciFixPrompt', () => {
  it('has correct metadata', () => {
    expect(ciFixPrompt.name).toBe('ci-fix');
    expect(ciFixPrompt.description).toContain('CI');
    expect(ciFixPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('includes repository, PR number, URL, branch, SHA, and check name', () => {
    const prompt = ciFixPrompt.build({
      repository: 'alice/intexuraos',
      prNumber: 42,
      prUrl: 'https://github.com/alice/intexuraos/pull/42',
      checkName: 'build',
      branch: 'main',
      headSha: 'abc123',
    });

    expect(prompt).toContain('CI Failure Fix Task');
    expect(prompt).toContain('alice/intexuraos');
    expect(prompt).toContain('#42');
    expect(prompt).toContain('https://github.com/alice/intexuraos/pull/42');
    expect(prompt).toContain('main');
    expect(prompt).toContain('abc123');
    expect(prompt).toContain('build');
    expect(prompt).toContain('pnpm run ci:tracked');
  });
});

describe('executeCIFailureDispatch', () => {
  let deps: WebhookDispatchServiceDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it('returns failure when the task lookup errors', async () => {
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(
      err({ code: 'x' as never, message: 'db failure' }),
    );

    const result = await executeCIFailureDispatch(deps, { event: baseEvent, logger: mockLogger });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to find task: db failure');
  });

  it('skips with no_original_task when no original task exists', async () => {
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(null));

    const result = await executeCIFailureDispatch(deps, { event: baseEvent, logger: mockLogger });

    expect(result).toEqual({
      success: true,
      fixTaskCreated: false,
      skipped: true,
      skipReason: 'no_original_task',
    });
  });

  it('skips to prevent loop when original task is already a ci_failure follow-up', async () => {
    const originalTask = {
      id: 'task-parent',
      userId: 'user-1',
      workerType: 'claude' as const,
      workerLocation: 'home',
      baseBranch: 'main',
      followUpReason: 'ci_failure' as const,
    };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(originalTask as never));

    const result = await executeCIFailureDispatch(deps, { event: baseEvent, logger: mockLogger });

    expect(result).toEqual({
      success: true,
      fixTaskCreated: false,
      skipped: true,
      skipReason: 'already_follow_up',
    });
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
  });

  it('creates a follow-up fix task, enqueues it, and notifies the user', async () => {
    const originalTask = {
      id: 'task-parent',
      userId: 'user-1',
      workerType: 'claude' as const,
      workerLocation: 'home',
      baseBranch: 'main',
      linearIssueId: 'INT-999',
    };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(originalTask as never));
    vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(ok({ id: 'task-fix' } as never));

    const result = await executeCIFailureDispatch(deps, { event: baseEvent, logger: mockLogger });

    expect(result).toEqual({
      success: true,
      fixTaskCreated: true,
      parentTaskId: 'task-parent',
      fixTaskId: 'task-fix',
    });
    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalledWith({ taskId: 'task-fix', userId: 'user-1' });
    expect(deps.whatsappNotifier.notifyCIFailure).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        repository: 'alice/intexuraos',
        pullRequestNumber: 42,
        checkName: 'build',
      }),
    );
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'alice/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'ci_failure_detected', checkName: 'build' }),
      'user-1',
    );
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'alice/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'fix_task_dispatched', parentTaskId: 'task-parent', fixTaskId: 'task-fix' }),
      'user-1',
    );

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.id).toMatch(/^task_/);
    expect(createCall?.webhookSecret).toBe(
      generateWebhookSecret(deps.orchestratorSecret, createCall?.id ?? '')
    );
  });

  it('returns failure when create fails', async () => {
    const originalTask = {
      id: 'task-parent',
      userId: 'user-1',
      workerType: 'claude' as const,
      workerLocation: 'home',
      baseBranch: 'main',
    };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(originalTask as never));
    vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(
      err({ code: 'y' as never, message: 'cannot write' }),
    );

    const result = await executeCIFailureDispatch(deps, { event: baseEvent, logger: mockLogger });

    expect(result.success).toBe(false);
    expect(result.fixTaskCreated).toBe(false);
    expect(result.error).toBe('Failed to create task: cannot write');
  });

  it('handles missing payload fields with defaults', async () => {
    const originalTask = {
      id: 'task-parent',
      userId: 'user-1',
      workerType: 'claude' as const,
      workerLocation: 'home',
      baseBranch: 'main',
    };
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockResolvedValue(ok(originalTask as never));
    vi.mocked(deps.codeTaskRepo.create).mockResolvedValue(ok({ id: 'task-fix' } as never));

    const eventWithNoPayload: GitHubPREvent = { ...baseEvent, payload: null, baseBranch: null };
    const result = await executeCIFailureDispatch(deps, { event: eventWithNoPayload, logger: mockLogger });

    expect(result.fixTaskCreated).toBe(true);
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ checkName: 'Unknown Check', headBranch: 'unknown', headSha: 'unknown', checkSuiteId: 0 }),
      'user-1',
    );

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0]?.[0];
    expect(createCall?.id).toMatch(/^task_/);
    expect(createCall?.webhookSecret).toBe(
      generateWebhookSecret(deps.orchestratorSecret, createCall?.id ?? '')
    );
  });

  it('wraps unexpected errors', async () => {
    vi.mocked(deps.codeTaskRepo.findLatestExecutionTaskByPR).mockRejectedValue(new Error('network'));

    const result = await executeCIFailureDispatch(deps, { event: baseEvent, logger: mockLogger });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unexpected error: network');
  });
});
