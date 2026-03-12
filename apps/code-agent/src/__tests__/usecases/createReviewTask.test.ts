/**
 * Tests for createReviewTask use case.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { UserLookupService } from '../../domain/ports/userLookupService.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { createReviewTask, type CreateReviewTaskDeps } from '../../domain/usecases/createReviewTask.js';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function createFakeLinearAgentClient(): LinearAgentClient {
  return {
    createIssue: vi.fn().mockResolvedValue(ok({
      issueId: 'issue-id-300',
      issueIdentifier: 'INT-300',
      issueTitle: 'Created issue',
      issueUrl: 'https://linear.app/INT-300',
    })),
    updateIssueState: vi.fn().mockResolvedValue(ok(undefined)),
    validateIssue: vi.fn().mockResolvedValue(ok(undefined)),
    generateTitle: vi.fn().mockResolvedValue(ok({ title: 'Generated', issueType: 'feature' as const })),
    addComment: vi.fn().mockResolvedValue(ok({ commentId: 'c-1' })),
    getIssueTree: vi.fn().mockResolvedValue(ok({ root: { id: '1', identifier: 'INT-1', url: '', parentId: null, labels: [], assigneeId: null, state: 'backlog' }, descendants: [] })),
    getIssueForDisplay: vi.fn().mockResolvedValue(ok(null)),
  } as unknown as LinearAgentClient;
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
  } as unknown as GitHubPRClient;
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

function createFakeDeps(overrides: Partial<CreateReviewTaskDeps> = {}): CreateReviewTaskDeps {
  return {
    logger: createFakeLogger(),
    codeTaskRepo: {
      create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
      findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      findById: vi.fn().mockResolvedValue(ok(null)),
      findByUser: vi.fn().mockResolvedValue(ok([])),
      update: vi.fn().mockResolvedValue(ok(undefined)),
    } as unknown as CodeTaskRepository,
    userLookupService: {
      resolveByGitHubUsername: vi.fn().mockResolvedValue(ok({
        userId: 'user-1',
        worker: {
          name: 'worker-1',
          url: 'https://worker.example.com',
          cfAccessClientId: 'cf-id',
          cfAccessClientSecret: 'cf-secret',
          dispatchSigningSecret: 'dispatch-secret',
          workerType: 'auto' as const,
          enabled: true,
        },
      })),
    } as unknown as UserLookupService,
    taskDispatcher: {
      dispatch: vi.fn().mockResolvedValue(ok({
        dispatched: true,
        workerLocation: 'worker-1',
      })),
    } as unknown as TaskDispatcherService,
    linearAgentClient: createFakeLinearAgentClient(),
    gitHubPRClient: createFakeGitHubPRClient(),
    userServiceClient: createFakeUserServiceClient(),
    orchestratorSecret: 'test-secret',
    serviceUrl: 'https://code-agent.example.com',
    ...overrides,
  };
}

describe('createReviewTask', () => {
  it('creates task with agentType review and dispatches', async () => {
    const deps = createFakeDeps();
    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality', 'security'],
      eventId: 'evt-1',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('created');
      expect(result.value.taskId).toBe('task-review-1');
    }

    expect(deps.taskDispatcher.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'review',
        systemPromptHash: 'review-auto',
        webhookUrl: 'https://code-agent.example.com/internal/webhooks/task-complete',
      })
    );

    // Verify task status is updated to dispatched after successful dispatch
    expect(deps.codeTaskRepo.update).toHaveBeenCalledWith(
      'task-review-1',
      { status: 'dispatched' }
    );
  });

  it('returns already_running when an active review task exists for the PR', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-2' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'auto',
          workerLocation: 'mac-dev',
        })),
        findByPR: vi.fn().mockResolvedValue(ok(null)),
        findById: vi.fn().mockResolvedValue(ok(null)),
        findByUser: vi.fn().mockResolvedValue(ok([])),
        update: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as CodeTaskRepository,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-already-running',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      status: 'already_running',
      taskId: 'task-review-existing',
    });
    expect(deps.userLookupService.resolveByGitHubUsername).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.taskDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('posts skip notification using the active task owner token', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const userServiceClient = createFakeUserServiceClient();
    const deps = createFakeDeps({
      gitHubPRClient,
      userServiceClient,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-2' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'claude-code',
          workerLocation: 'office-mac',
        })),
        findByPR: vi.fn().mockResolvedValue(ok(null)),
        findById: vi.fn().mockResolvedValue(ok(null)),
        findByUser: vi.fn().mockResolvedValue(ok([])),
        update: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as CodeTaskRepository,
    });

    await createReviewTask(deps, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-skip-comment',
    });

    expect(userServiceClient.getOAuthToken).toHaveBeenCalledWith('user-existing', 'github');
    expect(gitHubPRClient.postPRComment).toHaveBeenCalledWith(
      'ghp_test_token',
      'pbuchman',
      'intexuraos',
      42,
      expect.stringContaining('### Automated Code Review Request Skipped')
    );
    const commentBody = vi.mocked(gitHubPRClient.postPRComment).mock.calls[0]?.[4];
    expect(commentBody).toContain('**Existing Task ID:** `task-review-existing`');
    expect(commentBody).toContain('**Worker Type:** `claude-code`');
    expect(commentBody).toContain('**Worker:** `office-mac`');
  });

  it('returns task_creation_failed when active review lookup fails', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-2' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(
          err({ code: 'FIRESTORE_ERROR' as const, message: 'Lookup failed' })
        ),
        findByPR: vi.fn().mockResolvedValue(ok(null)),
        findById: vi.fn().mockResolvedValue(ok(null)),
        findByUser: vi.fn().mockResolvedValue(ok([])),
        update: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as CodeTaskRepository,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-active-review-error',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('task_creation_failed');
    expect(result.error.message).toBe('Lookup failed');
    expect(deps.userLookupService.resolveByGitHubUsername).not.toHaveBeenCalled();
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.taskDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('does not include pr-comment label', async () => {
    const deps = createFakeDeps();
    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-2',
    });

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      const dispatchRequest = dispatchCall[0];
      expect(dispatchRequest.linearIssueLabels).not.toContain('pr-comment');
    }
  });

  it('includes review types in prompt', async () => {
    const deps = createFakeDeps();
    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality', 'security', 'architecture'],
      eventId: 'evt-3',
    });

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      const dispatchRequest = dispatchCall[0];
      expect(dispatchRequest.prompt).toContain('code_quality');
      expect(dispatchRequest.prompt).toContain('security');
      expect(dispatchRequest.prompt).toContain('architecture');
    }
  });

  it('uses selected worker type for review task creation and dispatch', async () => {
    const deps = createFakeDeps();

    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['architecture'],
      workerType: 'qwen',
      eventId: 'evt-worker-type',
    });

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
    expect(createCall).toBeDefined();
    if (createCall !== undefined) {
      expect(createCall[0].workerType).toBe('qwen');
    }

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      expect(dispatchCall[0].workerType).toBe('qwen');
    }
  });

  it('includes review request comment in prompt when provided', async () => {
    const deps = createFakeDeps();

    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['architecture'],
      workerType: 'qwen',
      reviewComment: '@review architecture',
      eventId: 'evt-review-comment',
    });

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      expect(dispatchCall[0].prompt).toContain('Triggered by review request comment');
      expect(dispatchCall[0].prompt).toContain('@review architecture');
    }
  });

  it('returns error when user lookup fails', async () => {
    const deps = createFakeDeps({
      userLookupService: {
        resolveByGitHubUsername: vi.fn().mockResolvedValue(
          err({ code: 'USER_NOT_FOUND' as const, message: 'Unknown user' })
        ),
      } as unknown as UserLookupService,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'unknown',
      reviewTypes: ['code_quality'],
      eventId: 'evt-4',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('user_not_found');
    }
  });

  it('returns task_creation_failed when codeTaskRepo.create fails', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(
          err({ code: 'FIRESTORE_ERROR' as const, message: 'Firestore unavailable' })
        ),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
      } as unknown as CodeTaskRepository,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-6',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_creation_failed');
    }
  });

  it('returns no_workers_configured when user lookup returns NO_ENABLED_WORKER', async () => {
    const deps = createFakeDeps({
      userLookupService: {
        resolveByGitHubUsername: vi.fn().mockResolvedValue(
          err({ code: 'NO_ENABLED_WORKER' as const, message: 'No workers enabled for user' })
        ),
      } as unknown as UserLookupService,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-7',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no_workers_configured');
    }
  });

  it('uses provided baseBranch instead of default main', async () => {
    const deps = createFakeDeps();
    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-8',
      baseBranch: 'development',
    });

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
    expect(createCall).toBeDefined();
    if (createCall !== undefined) {
      expect(createCall[0].baseBranch).toBe('development');
    }

    const dispatchCall = vi.mocked(deps.taskDispatcher.dispatch).mock.calls[0];
    expect(dispatchCall).toBeDefined();
    if (dispatchCall !== undefined) {
      expect(dispatchCall[0].baseBranch).toBe('development');
    }
  });

  it('returns error when dispatch fails', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const deps = createFakeDeps({
      gitHubPRClient,
      taskDispatcher: {
        dispatch: vi.fn().mockResolvedValue(
          err({ code: 'QUEUE_FULL' as const, message: 'Queue full' })
        ),
      } as unknown as TaskDispatcherService,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-5',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('dispatch_failed');
    }

    // Verify task is marked as failed with error details
    expect(deps.codeTaskRepo.update).toHaveBeenCalledWith(
      'task-review-1',
      {
        status: 'failed',
        error: { code: 'dispatch_failed', message: 'Queue full' },
      }
    );

    // Verify dispatch failure comment was posted
    expect(gitHubPRClient.postPRComment).toHaveBeenCalled();
    const commentCall = vi.mocked(gitHubPRClient.postPRComment).mock.calls[0];
    expect(commentCall).toBeDefined();
    if (commentCall !== undefined) {
      const commentBody = commentCall[4];
      expect(commentBody).toContain('Review Dispatch Failed');
      expect(commentBody).toContain('QUEUE_FULL');
      expect(commentBody).toContain('Task was NOT queued');
    }
  });

  describe('PR notification after dispatch', () => {
    it('posts task-created comment after successful dispatch', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      const deps = createFakeDeps({ gitHubPRClient });

      await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-notify-1',
        prTitle: 'Fix bug',
      });

      expect(gitHubPRClient.postPRComment).toHaveBeenCalledWith(
        'ghp_test_token',
        'pbuchman',
        'intexuraos',
        42,
        expect.stringContaining('@ignore')
      );
      expect(gitHubPRClient.postPRComment).toHaveBeenCalledWith(
        'ghp_test_token',
        'pbuchman',
        'intexuraos',
        42,
        expect.stringContaining('**Dispatch outcome:** Review task dispatched')
      );
    });

    it('updates PR title with Linear issue ID when not already tagged', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      const deps = createFakeDeps({ gitHubPRClient });

      await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-notify-2',
        prTitle: 'Fix bug',
      });

      // Linear issue INT-300 is created by the fake linear agent client
      expect(gitHubPRClient.updatePRTitle).toHaveBeenCalledWith(
        'ghp_test_token',
        'pbuchman',
        'intexuraos',
        42,
        '[INT-300] Fix bug'
      );
    });

    it('skips PR title update when title already has INT-XXX tag', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      const deps = createFakeDeps({ gitHubPRClient });

      await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-notify-3',
        prTitle: '[INT-200] Fix bug',
      });

      expect(gitHubPRClient.updatePRTitle).not.toHaveBeenCalled();
    });

    it('does not block task creation when notification fails', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      vi.mocked(gitHubPRClient.postPRComment).mockRejectedValue(new Error('Network crash'));
      const deps = createFakeDeps({ gitHubPRClient });

      const result = await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-notify-4',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
    });
  });

  describe('Linear issue linking', () => {
    it('copies linearIssueId from existing PR task', async () => {
      const deps = createFakeDeps({
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
          findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
          findByPR: vi.fn().mockResolvedValue(ok({ id: 'task-existing', linearIssueId: 'INT-100' })),
          findById: vi.fn().mockResolvedValue(ok(null)),
          findByUser: vi.fn().mockResolvedValue(ok([])),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
      });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-1',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-100');
      }
    });

    it('extracts linearIssueId from PR title', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-2',
        prTitle: '[INT-200] Fix bug',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-200');
      }
      expect(deps.linearAgentClient?.createIssue).not.toHaveBeenCalled();
    });

    it('creates new Linear issue when no existing task and no title match', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-3',
        prTitle: 'Fix bug',
      });

      expect(deps.linearAgentClient?.createIssue).toHaveBeenCalledWith({
        userId: 'user-1',
        title: '[Review] PR #42: Fix bug',
        description: expect.stringContaining('Automated PR review created by GitHub Agent triage system.'),
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-300');
      }
    });

    it('proceeds without linearIssueId when linearAgentClient not provided', async () => {
      const { linearAgentClient: _removed, ...depsWithout } = createFakeDeps();
      const deps = depsWithout as CreateReviewTaskDeps;

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-4',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBeUndefined();
      }
    });

    it('proceeds without linearIssueId when findByPR and createIssue both fail', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.createIssue).mockResolvedValue(
        err({ code: 'UNAVAILABLE' as const, message: 'Service down' })
      );
      const deps = createFakeDeps({
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
          findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
          findByPR: vi.fn().mockResolvedValue(err({ code: 'FIRESTORE_ERROR' as const, message: 'DB error' })),
          findById: vi.fn().mockResolvedValue(ok(null)),
          findByUser: vi.fn().mockResolvedValue(ok([])),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
        linearAgentClient,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-5',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBeUndefined();
      }
    });

    it('proceeds without linearIssueId when resolveLinearIssueId throws', async () => {
      const deps = createFakeDeps({
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
          findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
          findByPR: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
          findById: vi.fn().mockResolvedValue(ok(null)),
          findByUser: vi.fn().mockResolvedValue(ok([])),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-6',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBeUndefined();
      }
    });

    it('uses fallback title when prTitle not provided', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-7',
      });

      expect(deps.linearAgentClient?.createIssue).toHaveBeenCalledWith({
        userId: 'user-1',
        title: '[Review] PR #42 in intexuraos/intexuraos',
        description: expect.stringContaining('Automated PR review created by GitHub Agent triage system.'),
      });
    });

    it('includes prBody in Linear issue description when provided', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality', 'security'],
        eventId: 'evt-link-8',
        prTitle: 'Fix auth bug',
        prBody: 'This PR fixes the authentication bypass vulnerability in the login flow.',
      });

      const createIssueCall = vi.mocked(linearAgentClient.createIssue).mock.calls[0];
      expect(createIssueCall).toBeDefined();
      if (createIssueCall !== undefined) {
        const description = createIssueCall[0].description;
        expect(description).toContain('Automated PR review created by GitHub Agent triage system.');
        expect(description).toContain('#42');
        expect(description).toContain('intexuraos/intexuraos');
        expect(description).toContain('This PR fixes the authentication bypass vulnerability in the login flow.');
        expect(description).toContain('code_quality');
        expect(description).toContain('security');
      }
    });

    it('truncates long prBody in Linear issue description', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      const deps = createFakeDeps({ linearAgentClient });
      const longBody = 'A'.repeat(600);

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-9',
        prTitle: 'Big PR',
        prBody: longBody,
      });

      const createIssueCall = vi.mocked(linearAgentClient.createIssue).mock.calls[0];
      expect(createIssueCall).toBeDefined();
      if (createIssueCall !== undefined) {
        const description = createIssueCall[0].description;
        expect(description).not.toContain(longBody);
        expect(description).toContain('...');
      }
    });
  });
});
