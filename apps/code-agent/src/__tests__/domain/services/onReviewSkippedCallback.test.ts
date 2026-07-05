import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { err, ok, type Logger } from '@intexuraos/common-core';
import type { AutomationLog } from '../../../domain/ports/automationLog.js';
import type {
  GitHubPRClient,
  GitHubPullRequestDetails,
} from '../../../domain/ports/gitHubPRClient.js';
import type { LinearAgentClient } from '../../../domain/ports/linearAgentClient.js';
import type { TaskGroupSummaryRepository } from '../../../domain/ports/taskGroupSummaryRepository.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import { createOnReviewSkippedCallback } from '../../../domain/services/onReviewSkippedCallback.js';
import { notifyTaskReadyForMergeIfEligible } from '../../../domain/services/readyToMergeNotification.js';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createFakeCodeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    repository: 'pbuchman/intexuraos',
    agentType: 'execution',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CodeTask;
}

function createPullRequestDetails(
  overrides: Partial<GitHubPullRequestDetails> = {},
): GitHubPullRequestDetails {
  return {
    number: 42,
    title: 'Test PR',
    body: null,
    state: 'open',
    authorLogin: 'octocat',
    baseBranch: 'development',
    headBranch: 'feature/test',
    mergeable: true,
    mergeableState: 'clean',
    headSha: 'abc123',
    createdAt: '2026-07-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('onReviewSkipped callback branches', () => {
  let mockCodeTaskRepo: CodeTaskRepository;
  let mockLinearAgentClient: LinearAgentClient;
  let mockGitHubPRClient: Pick<GitHubPRClient, 'getPullRequestDetails'>;
  let mockWhatsAppNotifier: Pick<WhatsAppNotifier, 'notifyTaskReadyForMerge'>;
  let mockAutomationLog: AutomationLog;
  let mockGroupSummaryRepo: TaskGroupSummaryRepository;
  let resolveGitHubToken: Mock<(userId: string) => Promise<string | null>>;
  let logger: Logger;

  function createCallback(): ReturnType<typeof createOnReviewSkippedCallback> {
    return createOnReviewSkippedCallback({
      codeTaskRepo: mockCodeTaskRepo,
      linearAgentClient: mockLinearAgentClient,
      gitHubPRClient: mockGitHubPRClient,
      whatsappNotifier: mockWhatsAppNotifier,
      resolveGitHubToken: async (userId: string) => await resolveGitHubToken(userId),
      automationLog: mockAutomationLog,
      groupSummaryRepo: mockGroupSummaryRepo,
      logger,
    });
  }

  beforeEach(() => {
    logger = createFakeLogger();

    mockCodeTaskRepo = {
      findOriginTaskByPR: vi.fn(),
    } as unknown as CodeTaskRepository;

    mockLinearAgentClient = {
      validateIssue: vi.fn(),
      updateIssueMetadata: vi.fn(),
    } as unknown as LinearAgentClient;

    mockGitHubPRClient = {
      getPullRequestDetails: vi.fn().mockResolvedValue(ok(createPullRequestDetails())),
    };

    mockWhatsAppNotifier = {
      notifyTaskReadyForMerge: vi.fn().mockResolvedValue(ok(undefined)),
    };

    resolveGitHubToken = vi.fn<(userId: string) => Promise<string | null>>().mockResolvedValue('github-token');

    mockAutomationLog = {
      record: vi.fn().mockResolvedValue(undefined),
    } as unknown as AutomationLog;

    mockGroupSummaryRepo = {
      recomputeWithLabels: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as TaskGroupSummaryRepository;
  });

  it('skips when findOriginTaskByPR returns error', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi
      .fn()
      .mockResolvedValue(err({ code: 'NOT_FOUND', message: 'not found' }));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.debug).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.stringContaining('No origin task found'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
  });

  it('skips when findOriginTaskByPR returns null', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(ok(null));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.debug).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.stringContaining('No origin task found'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
  });

  it('skips when origin task has no Linear issue ID', async () => {
    const { linearIssueId: _omit, ...taskWithoutLinearIssue } = createFakeCodeTask();
    mockCodeTaskRepo.findOriginTaskByPR = vi
      .fn()
      .mockResolvedValue(ok(taskWithoutLinearIssue as CodeTask));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.debug).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.stringContaining('no Linear issue'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
  });

  it('skips when origin is a planning task', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ agentType: 'planning', linearIssueId: 'INT-123' })),
    );

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-123' }),
      expect.stringContaining('planning-origin task'),
    );
    expect(mockLinearAgentClient.validateIssue).not.toHaveBeenCalled();
    expect(mockWhatsAppNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
  });

  it('warns and returns when validateIssue fails', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ linearIssueId: 'INT-123' })),
    );
    mockLinearAgentClient.validateIssue = vi
      .fn()
      .mockResolvedValue(err({ code: 'NOT_FOUND', message: 'Issue not found' }));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-123' }),
      expect.stringContaining('Failed to validate issue'),
    );
    expect(mockLinearAgentClient.updateIssueMetadata).not.toHaveBeenCalled();
  });

  it('warns and returns when ready-to-merge label is dropped', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ linearIssueId: 'INT-123' })),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({
        id: 'linear-id-123',
        identifier: 'INT-123',
        title: 'Test',
        url: 'https://linear.app/INT-123',
        labels: [],
      }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi
      .fn()
      .mockResolvedValue(ok({ droppedLabels: ['ready-to-merge'] }));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        linearIssueId: 'INT-123',
        droppedLabels: ['ready-to-merge'],
      }),
      expect.stringContaining('ready-to-merge label not found'),
    );
    expect(mockAutomationLog.record).not.toHaveBeenCalled();
    expect(mockGroupSummaryRepo.recomputeWithLabels).not.toHaveBeenCalled();
    expect(mockWhatsAppNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
  });

  it('sets label, sends ready notification, records automation log, and recomputes group summary on success', async () => {
    const origin = createFakeCodeTask({
      linearIssueId: 'INT-123',
      userId: 'user-1',
      result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
    });
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(ok(origin));
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({
        id: 'linear-id-123',
        identifier: 'INT-123',
        title: 'Test',
        url: 'https://linear.app/INT-123',
        labels: ['bug'],
      }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      ok({ droppedLabels: [] }),
    );

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(mockLinearAgentClient.updateIssueMetadata).toHaveBeenCalledWith({
      userId: 'user-1',
      issueId: 'linear-id-123',
      addLabels: ['ready-to-merge'],
    });
    expect(resolveGitHubToken).toHaveBeenCalledWith('user-1');
    expect(mockGitHubPRClient.getPullRequestDetails).toHaveBeenCalledWith(
      'github-token',
      'pbuchman',
      'intexuraos',
      42,
    );
    expect(mockWhatsAppNotifier.notifyTaskReadyForMerge).toHaveBeenCalledWith(
      'user-1',
      origin,
      {
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
        linearIssueId: 'INT-123',
      },
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        linearIssueId: 'INT-123',
      }),
      expect.stringContaining('Set ready-to-merge label'),
    );
    expect(mockAutomationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'remediation_decision', signal: '0' }),
    );
    expect(mockGroupSummaryRepo.recomputeWithLabels).toHaveBeenCalledWith(
      'user-1',
      'INT-123',
      expect.arrayContaining([
        { id: '', name: 'bug' },
        { id: '', name: 'ready-to-merge' },
      ]),
      expect.any(String),
    );
  });

  it('does not duplicate ready-to-merge label or notification when the label already exists', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(
        createFakeCodeTask({
          linearIssueId: 'INT-123',
          userId: 'user-1',
          result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
        }),
      ),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({
        id: 'linear-id-123',
        identifier: 'INT-123',
        title: 'Test',
        url: 'https://linear.app/INT-123',
        labels: ['ready-to-merge'],
      }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      ok({ droppedLabels: [] }),
    );

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(mockWhatsAppNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
    expect(mockGroupSummaryRepo.recomputeWithLabels).toHaveBeenCalledWith(
      'user-1',
      'INT-123',
      [{ id: '', name: 'ready-to-merge' }],
      expect.any(String),
    );
  });

  it('skips ready notification when the PR is not mergeable but still records label side effects', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(
        createFakeCodeTask({
          linearIssueId: 'INT-123',
          userId: 'user-1',
          result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
        }),
      ),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({
        id: 'linear-id-123',
        identifier: 'INT-123',
        title: 'Test',
        url: 'https://linear.app/INT-123',
        labels: [],
      }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      ok({ droppedLabels: [] }),
    );
    mockGitHubPRClient.getPullRequestDetails = vi
      .fn()
      .mockResolvedValue(ok(createPullRequestDetails({ mergeable: false, mergeableState: 'dirty' })));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(mockWhatsAppNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
    expect(mockAutomationLog.record).toHaveBeenCalled();
    expect(mockGroupSummaryRepo.recomputeWithLabels).toHaveBeenCalled();
  });

  it('keeps label, automation log, and group summary behavior when loading PR details fails', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(
        createFakeCodeTask({
          linearIssueId: 'INT-123',
          userId: 'user-1',
          result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
        }),
      ),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({
        id: 'linear-id-123',
        identifier: 'INT-123',
        title: 'Test',
        url: 'https://linear.app/INT-123',
        labels: [],
      }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      ok({ droppedLabels: [] }),
    );
    mockGitHubPRClient.getPullRequestDetails = vi
      .fn()
      .mockResolvedValue(err({ code: 'API_ERROR', message: 'GitHub unavailable' }));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(mockWhatsAppNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
    expect(mockAutomationLog.record).toHaveBeenCalled();
    expect(mockGroupSummaryRepo.recomputeWithLabels).toHaveBeenCalled();
  });

  it('keeps label, automation log, and group summary behavior when ready notification fails', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(
        createFakeCodeTask({
          linearIssueId: 'INT-123',
          userId: 'user-1',
          result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
        }),
      ),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({
        id: 'linear-id-123',
        identifier: 'INT-123',
        title: 'Test',
        url: 'https://linear.app/INT-123',
        labels: [],
      }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi.fn().mockResolvedValue(
      ok({ droppedLabels: [] }),
    );
    mockWhatsAppNotifier.notifyTaskReadyForMerge = vi
      .fn()
      .mockResolvedValue(err({ code: 'notification_failed', message: 'publish failed' }));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(mockAutomationLog.record).toHaveBeenCalled();
    expect(mockGroupSummaryRepo.recomputeWithLabels).toHaveBeenCalled();
  });

  it('warns when updateIssueMetadata returns error', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi.fn().mockResolvedValue(
      ok(createFakeCodeTask({ linearIssueId: 'INT-123' })),
    );
    mockLinearAgentClient.validateIssue = vi.fn().mockResolvedValue(
      ok({
        id: 'linear-id-123',
        identifier: 'INT-123',
        title: 'Test',
        url: 'https://linear.app/INT-123',
        labels: [],
      }),
    );
    mockLinearAgentClient.updateIssueMetadata = vi
      .fn()
      .mockResolvedValue(err({ code: 'UNAVAILABLE', message: 'Service unavailable' }));

    await createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-123' }),
      expect.stringContaining('Failed to set ready-to-merge label'),
    );
    expect(mockAutomationLog.record).not.toHaveBeenCalled();
    expect(mockWhatsAppNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
  });

  it('catches and logs unexpected errors without throwing', async () => {
    mockCodeTaskRepo.findOriginTaskByPR = vi
      .fn()
      .mockRejectedValue(new Error('database connection lost'));

    await expect(
      createCallback()({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
    ).resolves.not.toThrow();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
      expect.stringContaining('onReviewSkipped failed'),
    );
  });
});

describe('notifyTaskReadyForMergeIfEligible', () => {
  let logger: Logger;
  let gitHubPRClient: Pick<GitHubPRClient, 'getPullRequestDetails'>;
  let whatsappNotifier: Pick<WhatsAppNotifier, 'notifyTaskReadyForMerge'>;
  let resolveGitHubToken: Mock<(userId: string) => Promise<string | null>>;
  let task: CodeTask;

  beforeEach(() => {
    logger = createFakeLogger();
    gitHubPRClient = {
      getPullRequestDetails: vi.fn().mockResolvedValue(ok(createPullRequestDetails())),
    };
    whatsappNotifier = {
      notifyTaskReadyForMerge: vi.fn().mockResolvedValue(ok(undefined)),
    };
    resolveGitHubToken = vi.fn<(userId: string) => Promise<string | null>>().mockResolvedValue('github-token');
    task = createFakeCodeTask({ linearIssueId: 'INT-123' });
  });

  async function notify(overrides: Parameters<typeof notifyTaskReadyForMergeIfEligible>[1]): Promise<void> {
    await notifyTaskReadyForMergeIfEligible(
      {
        gitHubPRClient,
        whatsappNotifier,
        resolveGitHubToken: async (userId: string) => await resolveGitHubToken(userId),
        logger,
      },
      overrides,
    );
  }

  it('skips when no target user is available', async () => {
    await notify({ task, repository: 'pbuchman/intexuraos', prNumber: 42 });

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', userId: undefined }),
      expect.stringContaining('no target user'),
    );
    expect(gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(whatsappNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
  });

  it('skips when no PR number is available', async () => {
    await notify({ task, repository: 'pbuchman/intexuraos', userId: 'user-1' });

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', prNumber: undefined }),
      expect.stringContaining('no PR number'),
    );
    expect(gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(whatsappNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
  });

  it('skips when repository cannot be parsed', async () => {
    await notify({ task, repository: 'not-a-repo', prNumber: 42, userId: 'user-1' });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'not-a-repo', prNumber: 42 }),
      expect.stringContaining('invalid repository'),
    );
    expect(gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(whatsappNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
  });

  it('skips when an explicit PR URL is empty', async () => {
    await notify({ task, repository: 'pbuchman/intexuraos', prNumber: 42, userId: 'user-1', prUrl: '' });

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
      expect.stringContaining('no PR URL'),
    );
    expect(gitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
    expect(whatsappNotifier.notifyTaskReadyForMerge).not.toHaveBeenCalled();
  });

  it('sends ready notification without linearIssueId when none is provided', async () => {
    await notify({ task, repository: 'pbuchman/intexuraos', prNumber: 42, userId: 'user-1' });

    expect(whatsappNotifier.notifyTaskReadyForMerge).toHaveBeenCalledWith(
      'user-1',
      task,
      { prUrl: 'https://github.com/pbuchman/intexuraos/pull/42' },
    );
  });
});
