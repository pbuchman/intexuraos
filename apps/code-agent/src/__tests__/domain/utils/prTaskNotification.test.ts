/**
 * Tests for prTaskNotification utility.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { notifyPROfTaskCreation, fetchGitHubToken, type PRTaskNotificationDeps, type PRTaskNotificationRequest } from '../../../domain/utils/prTaskNotification.js';

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
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 42 })),
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

describe('notifyPROfTaskCreation', () => {
  it('posts task-created comment with @ignore prefix', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskCreation(deps, request);

    expect(deps.gitHubPRClient.postPRComment).toHaveBeenCalledWith(
      'ghp_test_token',
      'pbuchman',
      'intexuraos',
      42,
      expect.stringContaining('@ignore')
    );
  });

  it('comment includes task ID and exact View in IntexuraOS link label', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskCreation(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('task_abc123');
    expect(body).toContain('Automated Code Review Task Created');
    expect(body).toContain(
      '[View in IntexuraOS](https://intexuraos.cloud/#/code-tasks/task_abc123)'
    );
  });

  it('comment includes Linear issue ID when provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ linearIssueId: 'INT-809' });

    await notifyPROfTaskCreation(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('INT-809');
  });

  it('comment includes review types when provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ reviewTypes: ['code_quality', 'security'] });

    await notifyPROfTaskCreation(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('`code_quality`, `security`');
  });

  it('updates PR title when not already tagged and linearIssueId provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      linearIssueId: 'INT-809',
      prTitle: 'Fix the bug',
      titleAlreadyTagged: false,
    });

    await notifyPROfTaskCreation(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).toHaveBeenCalledWith(
      'ghp_test_token',
      'pbuchman',
      'intexuraos',
      42,
      '[INT-809] Fix the bug'
    );
  });

  it('skips PR title update when already tagged', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({
      linearIssueId: 'INT-809',
      prTitle: '[INT-809] Fix the bug',
      titleAlreadyTagged: true,
    });

    await notifyPROfTaskCreation(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
  });

  it('skips PR title update when linearIssueId not provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ prTitle: 'Fix the bug' });

    await notifyPROfTaskCreation(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
  });

  it('skips PR title update when prTitle not provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ linearIssueId: 'INT-809' });

    await notifyPROfTaskCreation(deps, request);

    expect(deps.gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
  });

  it('returns early when repository format is invalid', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ repository: 'noslash' });

    await notifyPROfTaskCreation(deps, request);

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

    await notifyPROfTaskCreation(deps, request);

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
      titleAlreadyTagged: false,
    });

    await notifyPROfTaskCreation(deps, request);

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

    await notifyPROfTaskCreation(deps, request);

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc123' }),
      expect.stringContaining('comment')
    );
  });

  it('swallows unexpected exceptions (best-effort)', async () => {
    const deps = createFakeDeps();
    vi.mocked(deps.userServiceClient.getOAuthToken).mockRejectedValue(new Error('Network crash'));
    const request = createFakeRequest();

    await expect(notifyPROfTaskCreation(deps, request)).resolves.toBeUndefined();

    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_abc123' }),
      expect.stringContaining('Unexpected error')
    );
  });

  it('omits Linear issue line when linearIssueId is undefined', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskCreation(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).not.toContain('**Linear Issue:**');
  });

  it('omits review types line when reviewTypes is undefined', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskCreation(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).not.toContain('**Review types:**');
  });

  it('includes reviewer line when workerType is provided', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest({ workerType: 'auto' });

    await notifyPROfTaskCreation(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).toContain('**Reviewer:** `auto`');
  });

  it('omits reviewer line when workerType is undefined', async () => {
    const deps = createFakeDeps();
    const request = createFakeRequest();

    await notifyPROfTaskCreation(deps, request);

    const body = vi.mocked(deps.gitHubPRClient.postPRComment).mock.calls[0]?.[4] as string;
    expect(body).not.toContain('**Reviewer:**');
  });
});
