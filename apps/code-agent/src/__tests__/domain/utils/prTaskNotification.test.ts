/**
 * Tests for prTaskNotification utility.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import {
  notifyPROfTaskDispatch,
  fetchGitHubToken,
  notifyDispatchFailed,
  notifyTaskOutcome,
  buildTaskOutcomeComment,
  buildReviewReplacementComment,
  notifyReviewReplaced,
  type PRTaskNotificationDeps,
  type PRTaskNotificationRequest,
  type DispatchFailedCommentRequest,
  type TaskOutcomeCommentRequest,
  type ReviewReplacementCommentRequest,
} from '../../../domain/utils/prTaskNotification.js';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createFakeGitHubPRClient(): GitHubPRClient {
  return {
    updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
    getPullRequestFiles: vi.fn().mockResolvedValue(ok([])),
    getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
    getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('main')),
    getPullRequestStatus: vi.fn().mockResolvedValue(
      ok({ state: 'open', mergedAt: null, headRef: 'task_existing_pr_branch' })
    ),
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 42 })),
    listOpenPullRequestsByBaseBranch: vi.fn().mockResolvedValue(ok([])),
    getPullRequestDetails: vi.fn().mockResolvedValue(ok({
      number: 42,
      title: 'Test PR',
      body: null,
      authorLogin: 'alice',
      baseBranch: 'main',
      headBranch: 'feature/test',
      mergeable: true,
      mergeableState: 'clean',
    })),
    updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 42 })),
  };
}

function createFakeUserServiceClient(): UserServiceClient {
  return {
    getApiKeys: vi.fn().mockResolvedValue(ok({})),
    getLlmClient: vi.fn().mockResolvedValue(err({ code: 'NO_API_KEY', message: 'mock' })),
    reportLlmSuccess: vi.fn().mockResolvedValue(undefined),
    getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'ghp_test_token', email: 'test@example.com' })),
    resolveGitHubUsername: vi.fn().mockResolvedValue(ok(null)),
  } as unknown as UserServiceClient;
}

function createFakeDeps(): PRTaskNotificationDeps {
  return {
    logger: createFakeLogger(),
    gitHubPRClient: createFakeGitHubPRClient(),
    userServiceClient: createFakeUserServiceClient(),
  };
}

function createFakeRequest(overrides: Partial<PRTaskNotificationRequest> = {}): PRTaskNotificationRequest {
  return {
    taskId: 'task_abc123',
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    userId: 'user-1',
    dispatchOutcome: 'created_and_dispatched',
    updateTitle: true,
    titleAlreadyTagged: false,
    ...overrides,
  };
}

describe('fetchGitHubToken', () => {
  it('returns access token when available', async () => {
    const userServiceClient = createFakeUserServiceClient();
    const logger = createFakeLogger();

    const token = await fetchGitHubToken(userServiceClient, 'user-1', logger);

    expect(token).toBe('ghp_test_token');
  });

  it('returns null when token is not available', async () => {
    const userServiceClient = createFakeUserServiceClient();
    vi.mocked(userServiceClient.getOAuthToken).mockResolvedValue(
      err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' }) as never
    );
    const logger = createFakeLogger();

    const token = await fetchGitHubToken(userServiceClient, 'user-1', logger);

    expect(token).toBe(null);
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe('notifyPROfTaskDispatch', () => {
  it('posts dispatch comment with @ignore prefix', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalledWith(
      'ghp_test_token',
      'pbuchman',
      'intexuraos',
      42,
      expect.stringContaining('@ignore')
    );
  });

  it('comment includes task ID, link, and dispatch outcome', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('task_abc123');
    expect(body).toContain('[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/task_abc123)');
    expect(body).toContain('intexuraos.cloud/#/code-tasks/task_abc123');
    expect(body).toContain('Automated Code Review Task');
    expect(body).toContain('**Dispatch outcome:** Created and dispatched');
  });

  it('comment includes Linear issue ID when provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ linearIssueId: 'INT-809' });

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('INT-809');
  });

  it('comment includes review types when provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      dispatchOutcome: 'review_task_dispatched',
      reviewTypes: ['code_quality', 'security'],
    });

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('`code_quality`, `security`');
  });

  it('uses outcome-specific wording for existing-task resumes', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      dispatchOutcome: 'existing_task_resumed',
      updateTitle: false,
    });

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('**Dispatch outcome:** Existing task resumed');
  });

  it('updates PR title when enabled, not already tagged, and linearIssueId provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      linearIssueId: 'INT-809',
      prTitle: 'Fix the bug',
      updateTitle: true,
      titleAlreadyTagged: false,
    });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).toHaveBeenCalledWith(
      'ghp_test_token',
      'pbuchman',
      'intexuraos',
      42,
      '[INT-809] Fix the bug'
    );
  });

  it('posts the PR comment before attempting to update the title', async () => {
    const deps = createFakeDeps();
    const callOrder: string[] = [];
    vi.mocked(deps.gitHubPRClient.postPRComment).mockImplementation(async () => {
      callOrder.push('comment');
      return ok({ commentId: 42 });
    });
    vi.mocked(deps.gitHubPRClient.updatePRTitle).mockImplementation(async () => {
      callOrder.push('title');
      return ok(undefined);
    });

    await notifyPROfTaskDispatch(
      deps,
      createFakeRequest({
        linearIssueId: 'INT-809',
        prTitle: 'Fix the bug',
        updateTitle: true,
      }),
    );

    expect(callOrder).toEqual(['comment', 'title']);
  });

  it('skips PR title update when already tagged', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      linearIssueId: 'INT-809',
      prTitle: '[INT-809] Fix the bug',
      updateTitle: true,
      titleAlreadyTagged: true,
    });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
  });

  it('skips PR title update when disabled for existing-task notifications', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      dispatchOutcome: 'existing_task_queued',
      linearIssueId: 'INT-809',
      prTitle: 'Fix the bug',
      updateTitle: false,
    });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
  });

  it('skips PR title update when linearIssueId not provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ prTitle: 'Fix the bug', updateTitle: true });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
  });

  it('skips PR title update when prTitle not provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ linearIssueId: 'INT-809', updateTitle: true });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
  });

  it('returns early when repository format is invalid', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ repository: 'noslash' });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns early when OAuth token is not available', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockResolvedValue(
      err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' }) as never
    );
    const request = createFakeRequest();

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', taskId: 'task_abc123' }),
      expect.stringContaining('no GitHub OAuth token'),
    );
  });

  it('logs warning when PR title update fails (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.gitHubPRClient.updatePRTitle).mockResolvedValue(
      err({ code: 'API_ERROR', message: 'GitHub API error' })
    );
    const request = createFakeRequest({
      linearIssueId: 'INT-809',
      prTitle: 'Fix the bug',
      updateTitle: true,
      titleAlreadyTagged: false,
    });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 }),
      expect.stringContaining('PR title')
    );
    // Should still post the comment
    expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalled();
  });

  it('logs warning when comment posting fails (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.gitHubPRClient.postPRComment).mockResolvedValue(
      err({ code: 'UNAUTHORIZED', message: 'Bad token' })
    );
    const request = createFakeRequest();

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc123' }),
      expect.stringContaining('comment')
    );
  });

  it('swallows unexpected exceptions (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockRejectedValue(new Error('Network crash'));
    const request = createFakeRequest();

    await expect(notifyPROfTaskDispatch(deps, request)).resolves.toBeUndefined();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc123' }),
      expect.stringContaining('Unexpected error')
    );
  });

  it('omits Linear issue line when linearIssueId is undefined', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).not.toContain('**Linear Issue:**');
  });

  it('omits review types line when reviewTypes is undefined', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).not.toContain('**Review types:**');
  });

  it('includes reviewer line when workerType is provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ workerType: 'auto' });

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('**Reviewer:** `auto`');
  });

  it('omits reviewer line when workerType is undefined', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskDispatch(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).not.toContain('**Reviewer:**');
  });

  it('skips comment posting when skipComment is true but still updates title', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      skipComment: true,
      linearIssueId: 'INT-809',
      prTitle: 'Fix the bug',
      updateTitle: true,
      titleAlreadyTagged: false,
    });

    await notifyPROfTaskDispatch(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.gitHubPRClient.updatePRTitle).toHaveBeenCalledWith(
      'ghp_test_token',
      'pbuchman',
      'intexuraos',
      42,
      '[INT-809] Fix the bug'
    );
  });
});

describe('notifyDispatchFailed', () => {
  function createDispatchFailedRequest(overrides: Partial<DispatchFailedCommentRequest> = {}): DispatchFailedCommentRequest {
    return {
      taskId: 'task_fail_test',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      failureType: 'review',
      errorCode: 'QUEUE_FULL',
      ...overrides,
    };
  }

  it('posts failure comment with @ignore prefix for review failure', async () => {
    const deps = createFakeDeps();
    const request = createDispatchFailedRequest({ failureType: 'review' });

    await notifyDispatchFailed(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('@ignore');
    expect(body).toContain('### Review Dispatch Failed');
    expect(body).toContain('**Task ID:** `task_fail_test`');
    expect(body).toContain('**Error:** QUEUE_FULL');
  });

  it('posts failure comment with pr_task failure type', async () => {
    const deps = createFakeDeps();
    const request = createDispatchFailedRequest({ failureType: 'pr_task', errorCode: 'RATE_LIMITED' });

    await notifyDispatchFailed(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Task Dispatch Failed');
    expect(body).toContain('**Error:** RATE_LIMITED');
  });

  it('extracts first part of error code before slash', async () => {
    const deps = createFakeDeps();
    const request = createDispatchFailedRequest({ errorCode: 'UPSTREAM_ERROR/network_timeout' });

    await notifyDispatchFailed(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('**Error:** UPSTREAM_ERROR');
  });

  it('returns early when repository format is invalid', async () => {
    const deps = createFakeDeps();
    const request = createDispatchFailedRequest({ repository: 'noslash' });

    await notifyDispatchFailed(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns early when GitHub token is not available', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockResolvedValue(
      err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' }) as never
    );
    const request = createDispatchFailedRequest();

    await notifyDispatchFailed(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it('logs warning when comment posting fails (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.gitHubPRClient.postPRComment).mockResolvedValue(
      err({ code: 'UNAUTHORIZED', message: 'Bad token' })
    );
    const request = createDispatchFailedRequest();

    await notifyDispatchFailed(deps, request);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 }),
      expect.stringContaining('dispatch failure comment')
    );
  });

  it('swallows unexpected exceptions (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockRejectedValue(new Error('Network crash'));
    const request = createDispatchFailedRequest();

    await expect(notifyDispatchFailed(deps, request)).resolves.toBeUndefined();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_fail_test' }),
      expect.stringContaining('Unexpected error')
    );
  });
});

describe('notifyTaskOutcome', () => {
  function createTaskOutcomeRequest(overrides: Partial<TaskOutcomeCommentRequest> = {}): TaskOutcomeCommentRequest {
    return {
      taskId: 'task_outcome_test',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'review_completed',
      ...overrides,
    };
  }

  it('posts review completed comment with review types', async () => {
    const deps = createFakeDeps();
    const request = createTaskOutcomeRequest({
      outcome: 'review_completed',
      reviewTypes: ['code_quality', 'security'],
    });

    await notifyTaskOutcome(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Automated Review Completed');
    expect(body).toContain('**Task ID:** `task_outcome_test`');
    expect(body).toContain('**Review types:** `code_quality`, `security`');
    expect(body).toContain('Review finished.');
  });

  it('posts review failed comment with error code', async () => {
    const deps = createFakeDeps();
    const request = createTaskOutcomeRequest({
      outcome: 'review_failed',
      errorCode: 'TIMEOUT',
    });

    await notifyTaskOutcome(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Automated Review Failed');
    expect(body).toContain('**Error:** TIMEOUT');
    expect(body).toContain('Review output did not complete.');
  });

  it('posts implementation completed comment', async () => {
    const deps = createFakeDeps();
    const request = createTaskOutcomeRequest({ outcome: 'implementation_completed' });

    await notifyTaskOutcome(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Implementation Completed');
    expect(body).toContain('Implementation finished.');
    expect(body).toContain('Changes have been pushed to the PR.');
  });

  it('posts implementation failed comment', async () => {
    const deps = createFakeDeps();
    const request = createTaskOutcomeRequest({
      outcome: 'implementation_failed',
      errorCode: 'EXECUTION_ERROR',
    });

    await notifyTaskOutcome(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Implementation Failed');
    expect(body).toContain('**Error:** EXECUTION_ERROR');
  });

  it('posts reply completed comment', async () => {
    const deps = createFakeDeps();
    const request = createTaskOutcomeRequest({ outcome: 'reply_completed' });

    await notifyTaskOutcome(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Reply Posted');
    expect(body).toContain('Reply posted.');
    expect(body).toContain('Check the PR comments for the response.');
  });

  it('posts reply failed comment with error code', async () => {
    const deps = createFakeDeps();
    const request = createTaskOutcomeRequest({
      outcome: 'reply_failed',
      errorCode: 'COMMENT_ERROR',
    });

    await notifyTaskOutcome(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Reply Failed');
    expect(body).toContain('**Error:** COMMENT_ERROR');
  });

  it('returns early when repository format is invalid', async () => {
    const deps = createFakeDeps();
    const request = createTaskOutcomeRequest({ repository: 'noslash' });

    await notifyTaskOutcome(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns early when GitHub token is not available', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockResolvedValue(
      err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' }) as never
    );
    const request = createTaskOutcomeRequest();

    await notifyTaskOutcome(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it('logs warning when comment posting fails (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.gitHubPRClient.postPRComment).mockResolvedValue(
      err({ code: 'UNAUTHORIZED', message: 'Bad token' })
    );
    const request = createTaskOutcomeRequest();

    await notifyTaskOutcome(deps, request);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 }),
      expect.stringContaining('task outcome comment')
    );
  });

  it('swallows unexpected exceptions (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockRejectedValue(new Error('Network crash'));
    const request = createTaskOutcomeRequest();

    await expect(notifyTaskOutcome(deps, request)).resolves.toBeUndefined();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_outcome_test' }),
      expect.stringContaining('Unexpected error')
    );
  });
});

describe('buildTaskOutcomeComment', () => {
  it('builds review completed comment with review types', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'review_completed',
      reviewTypes: ['code_quality', 'security'],
    });

    expect(comment).toContain('### Automated Review Completed');
    expect(comment).toContain('**Review types:** `code_quality`, `security`');
    expect(comment).toContain('Review finished.');
  });

  it('builds review completed comment without review types', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'review_completed',
    });

    expect(comment).toContain('### Automated Review Completed');
    expect(comment).toContain('Review finished.');
    expect(comment).not.toContain('**Review types:**');
  });

  it('builds review failed comment with error code', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'review_failed',
      errorCode: 'TIMEOUT',
    });

    expect(comment).toContain('### Automated Review Failed');
    expect(comment).toContain('**Error:** TIMEOUT');
    expect(comment).toContain('Review output did not complete.');
  });

  it('builds review failed comment without error code', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'review_failed',
    });

    expect(comment).toContain('### Automated Review Failed');
    expect(comment).not.toContain('**Error:**');
  });

  it('builds implementation completed comment', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'implementation_completed',
    });

    expect(comment).toContain('### Implementation Completed');
    expect(comment).toContain('Implementation finished.');
    expect(comment).toContain('Changes have been pushed to the PR.');
  });

  it('builds implementation failed comment', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'implementation_failed',
      errorCode: 'EXECUTION_ERROR',
    });

    expect(comment).toContain('### Implementation Failed');
    expect(comment).toContain('**Error:** EXECUTION_ERROR');
  });

  it('builds reply completed comment', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'reply_completed',
    });

    expect(comment).toContain('### Reply Posted');
    expect(comment).toContain('Reply posted.');
    expect(comment).toContain('Check the PR comments for the response.');
  });

  it('builds reply failed comment', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'reply_failed',
      errorCode: 'COMMENT_ERROR',
    });

    expect(comment).toContain('### Reply Failed');
    expect(comment).toContain('**Error:** COMMENT_ERROR');
  });

  it('builds review completed comment with worker type', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'review_completed',
      workerType: 'claude-code',
    });

    expect(comment).toContain('### Automated Review Completed');
    expect(comment).toContain('**Reviewer:** `claude-code`');
  });

  it('builds review failed comment with worker type', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'review_failed',
      errorCode: 'TIMEOUT',
      workerType: 'qwen',
    });

    expect(comment).toContain('### Automated Review Failed');
    expect(comment).toContain('**Reviewer:** `qwen`');
    expect(comment).toContain('**Error:** TIMEOUT');
  });

  it('omits reviewer line for non-review outcomes even when workerType provided', () => {
    const comment = buildTaskOutcomeComment({
      taskId: 'task_123',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      outcome: 'implementation_completed',
      workerType: 'claude-code',
    });

    expect(comment).toContain('### Implementation Completed');
    expect(comment).not.toContain('**Reviewer:**');
  });
});

describe('buildReviewReplacementComment', () => {
  it('builds replacement comment with cancelled task ID', () => {
    const comment = buildReviewReplacementComment({
      taskId: 'task_new',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      replacedTaskId: 'task_old_123',
    });

    expect(comment).toContain('@ignore');
    expect(comment).toContain('### Automated Code Review Cancelled');
    expect(comment).toContain('**Cancelled Task ID:** `task_old_123`');
    expect(comment).toContain('A new review has been requested');
  });

  it('includes old worker type when provided', () => {
    const comment = buildReviewReplacementComment({
      taskId: 'task_new',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      replacedTaskId: 'task_old_123',
      replacedWorkerType: 'minimax',
    });

    expect(comment).toContain('**Previous Reviewer:** `minimax`');
  });

  it('omits previous reviewer line when worker type not provided', () => {
    const comment = buildReviewReplacementComment({
      taskId: 'task_new',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      replacedTaskId: 'task_old_123',
    });

    expect(comment).not.toContain('**Previous Reviewer:**');
  });
});

describe('notifyReviewReplaced', () => {
  function createReplacementRequest(overrides: Partial<ReviewReplacementCommentRequest> = {}): ReviewReplacementCommentRequest {
    return {
      taskId: 'task_new',
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      userId: 'user-1',
      replacedTaskId: 'task_old_123',
      ...overrides,
    };
  }

  it('posts replacement comment with @ignore prefix', async () => {
    const deps = createFakeDeps();
    const request = createReplacementRequest();

    await notifyReviewReplaced(deps, request);

    expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalledWith(
      'ghp_test_token',
      'pbuchman',
      'intexuraos',
      42,
      expect.stringContaining('@ignore')
    );
  });

  it('comment includes cancelled task ID and replacement message', async () => {
    const deps = createFakeDeps();
    const request = createReplacementRequest();

    await notifyReviewReplaced(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('### Automated Code Review Cancelled');
    expect(body).toContain('**Cancelled Task ID:** `task_old_123`');
    expect(body).toContain('A new review has been requested');
  });

  it('includes previous worker type when provided', async () => {
    const deps = createFakeDeps();
    const request = createReplacementRequest({ replacedWorkerType: 'claude-code' });

    await notifyReviewReplaced(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('**Previous Reviewer:** `claude-code`');
  });

  it('returns early when repository format is invalid', async () => {
    const deps = createFakeDeps();
    const request = createReplacementRequest({ repository: 'noslash' });

    await notifyReviewReplaced(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns early when GitHub token is not available', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockResolvedValue(
      err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' }) as never
    );
    const request = createReplacementRequest();

    await notifyReviewReplaced(deps, request);

    expect(deps.gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it('logs warning when comment posting fails (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.gitHubPRClient.postPRComment).mockResolvedValue(
      err({ code: 'UNAUTHORIZED', message: 'Bad token' })
    );
    const request = createReplacementRequest();

    await notifyReviewReplaced(deps, request);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ prNumber: 42 }),
      expect.stringContaining('review replacement comment')
    );
  });

  it('swallows unexpected exceptions (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockRejectedValue(new Error('Network crash'));
    const request = createReplacementRequest();

    await expect(notifyReviewReplaced(deps, request)).resolves.toBeUndefined();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_new' }),
      expect.stringContaining('Unexpected error')
    );
  });
});
