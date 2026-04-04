/**
 * Tests for createReviewTask use case.
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err, type Logger } from '@intexuraos/common-core';
import type { CodeTaskRepository } from '../../domain/repositories/codeTaskRepository.js';
import type { UserLookupService } from '../../domain/ports/userLookupService.js';
import type { TaskDispatcherService } from '../../domain/services/taskDispatcher.js';
import type { TaskEnqueueService } from '../../domain/services/taskEnqueueService.js';
import type { LinearAgentClient } from '../../domain/ports/linearAgentClient.js';
import type { GitHubPRClient } from '../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { WorkerSettingsRepository } from '../../domain/ports/workerSettingsRepository.js';
import type { GitHubPRSummaryRepository } from '../../domain/repositories/gitHubPRSummaryRepository.js';
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
    getIssueDescription: vi.fn().mockResolvedValue(ok(undefined)),
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
      getUserTimezone: async (): Promise<string | undefined> => undefined,
  } as unknown as UserServiceClient;
}

function createFakeWorkerSettingsRepo(): WorkerSettingsRepository {
  return {
    getSettings: vi.fn().mockResolvedValue(ok({
      workers: [{
        name: 'worker-1',
        url: 'https://worker.example.com',
        cfAccessClientId: 'cf-id',
        cfAccessClientSecret: 'cf-secret',
        dispatchSigningSecret: 'dispatch-secret',
        workerType: 'auto' as const,
        enabled: true,
      }],
    })),
    saveSettings: vi.fn().mockResolvedValue(ok(undefined)),
    updateDefaultReviewWorkerType: vi.fn().mockResolvedValue(ok(undefined)),
  } as unknown as WorkerSettingsRepository;
}

function createFakeGitHubPRSummaryRepo(lastReviewedCommitSha: string | null = null): GitHubPRSummaryRepository {
  return {
    upsert: vi.fn().mockResolvedValue(ok(undefined)),
    findRecentlyActive: vi.fn().mockResolvedValue(ok([])),
    findByPullRequest: vi.fn().mockResolvedValue(ok({
      repository: 'intexuraos/intexuraos',
      pullRequestNumber: 42,
      title: 'Fix bug',
      state: 'open',
      mergedAt: null,
      baseBranch: 'main',
      authorLogin: 'dev-user',
      headBranch: 'feature/fix',
      mergeConflictStatus: null,
      lastConflictCheckedAt: null,
      conflictEpisodeStartedAt: null,
      conflictResolvedAt: null,
      managedConflictCommentId: null,
      managedConflictTaskId: null,
      managedConflictTaskOwnerUserId: null,
      lastActivityAt: new Date(),
      firstSeenAt: new Date(),
      lastReviewedCommitSha,
    })),
    findOpenByBaseBranch: vi.fn().mockResolvedValue(ok([])),
    findOpenByRepository: vi.fn().mockResolvedValue(ok([])),
    findAllOpen: vi.fn().mockResolvedValue(ok([])),
  } as unknown as GitHubPRSummaryRepository;
}

function createFakeTaskEnqueueService(): TaskEnqueueService {
  return {
    enqueue: vi.fn().mockResolvedValue(ok({
      taskId: 'task-review-1',
      queuePosition: 1,
    })),
  };
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
      countQueued: vi.fn().mockResolvedValue(ok(0)),
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
      cancelOnWorker: vi.fn().mockResolvedValue(undefined),
    } as unknown as TaskDispatcherService,
    taskEnqueueService: createFakeTaskEnqueueService(),
    linearAgentClient: createFakeLinearAgentClient(),
    gitHubPRClient: createFakeGitHubPRClient(),
    userServiceClient: createFakeUserServiceClient(),
    workerSettingsRepo: createFakeWorkerSettingsRepo(),
    orchestratorSecret: 'test-secret',
    automationLog: { record: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  };
}

describe('createReviewTask', () => {
  it('creates task with agentType review and enqueues', async () => {
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
      expect(result.value.status).toBe('queued');
      expect(result.value.taskId).toBe('task-review-1');
    }

    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalledWith({
      taskId: 'task-review-1',
      userId: 'user-1',
    });
  });

  it('cancels and replaces active review task, returning queued with new task ID', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const taskDispatcher = {
      dispatch: vi.fn().mockResolvedValue(ok({
        dispatched: true,
        workerLocation: 'worker-1',
      })),
      cancelOnWorker: vi.fn().mockResolvedValue(undefined),
    } as unknown as TaskDispatcherService;
    const taskEnqueueService = createFakeTaskEnqueueService();
    vi.mocked(taskEnqueueService.enqueue).mockResolvedValue(ok({
      taskId: 'task-review-new',
      queuePosition: 1,
    }));
    const deps = createFakeDeps({
      gitHubPRClient,
      taskDispatcher,
      taskEnqueueService,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'auto',
          workerLocation: 'worker-1',
          status: 'dispatched',
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
      eventId: 'evt-replace',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Always returns queued with new task ID
    expect(result.value).toEqual({
      status: 'queued',
      taskId: 'task-review-new',
      workerType: 'auto',
    });

    // Verify replacement was recorded in automation log
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'intexuraos/intexuraos', prNumber: 42 },
      expect.objectContaining({
        type: 'review_replaced',
        replacedTaskId: 'task-review-existing',
        replacedWorkerType: 'auto',
      }),
      'user-existing',
    );

    // Verify old task was cancelled locally
    expect(deps.codeTaskRepo.update).toHaveBeenCalledWith(
      'task-review-existing',
      expect.objectContaining({
        status: 'cancelled',
        error: expect.objectContaining({ code: 'review_replaced' }),
      })
    );

    // Verify worker cancellation was attempted (best-effort)
    expect(taskDispatcher.cancelOnWorker).toHaveBeenCalledWith(
      'task-review-existing',
      'worker-1',
      expect.objectContaining({ url: 'https://worker.example.com' })
    );

    // Verify new task was created and enqueued
    expect(deps.codeTaskRepo.create).toHaveBeenCalled();
    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalled();
  });

  it('returns error if local cancel fails and does not create new task', async () => {
    const deps = createFakeDeps({
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'auto',
          workerLocation: 'worker-1',
          status: 'running',
        })),
        findByPR: vi.fn().mockResolvedValue(ok(null)),
        findById: vi.fn().mockResolvedValue(ok(null)),
        findByUser: vi.fn().mockResolvedValue(ok([])),
        update: vi.fn()
          .mockResolvedValueOnce(err({ code: 'FIRESTORE_ERROR' as const, message: 'Update failed' }))
          .mockResolvedValue(ok(undefined)),
      } as unknown as CodeTaskRepository,
    });

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-cancel-fail',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('task_creation_failed');

    // Verify new task was NOT created
    expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    expect(deps.taskEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('creates new review task even if worker cancellation fails', async () => {
    const taskDispatcher = {
      dispatch: vi.fn().mockResolvedValue(ok({
        dispatched: true,
        workerLocation: 'worker-1',
      })),
      cancelOnWorker: vi.fn().mockRejectedValue(new Error('Worker unreachable')),
    } as unknown as TaskDispatcherService;
    const deps = createFakeDeps({
      taskDispatcher,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'qwen',
          workerLocation: 'worker-1',
          status: 'dispatched',
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
      eventId: 'evt-worker-cancel-fail',
    });

    // Should still succeed
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('queued');
    expect(result.value.taskId).toBe('task-review-new');

    // Verify new task was still created
    expect(deps.codeTaskRepo.create).toHaveBeenCalled();
    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalled();
  });

  it('creates new review task when worker settings are null', async () => {
    const deps = createFakeDeps({
      workerSettingsRepo: {
        getSettings: vi.fn().mockResolvedValue(ok(null)),
        saveSettings: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as WorkerSettingsRepository,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'auto',
          workerLocation: 'worker-1',
          status: 'dispatched',
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
      eventId: 'evt-null-settings',
    });

    // Should still succeed
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('queued');
    expect(result.value.taskId).toBe('task-review-new');

    // Verify new task was still created
    expect(deps.codeTaskRepo.create).toHaveBeenCalled();
    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalled();
  });

  it('creates new review task even if replacement comment fails to post', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    vi.mocked(gitHubPRClient.postPRComment).mockRejectedValue(new Error('GitHub API down'));
    const deps = createFakeDeps({
      gitHubPRClient,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'auto',
          workerLocation: 'worker-1',
          status: 'dispatched',
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
      eventId: 'evt-comment-fail',
    });

    // Should still succeed - fresh-start rule holds
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('queued');

    // Verify new task was still created
    expect(deps.codeTaskRepo.create).toHaveBeenCalled();
  });

  it('creates replacement when existing task owner token is unavailable', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const userServiceClient = createFakeUserServiceClient();
    // Return null for existing task owner's token
    vi.mocked(userServiceClient.getOAuthToken).mockImplementation(async (userId: string) => {
      if (userId === 'user-existing') {
        return err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' }) as never;
      }
      return ok({ accessToken: 'ghp_sender_token', email: 'test@example.com' });
    });
    const deps = createFakeDeps({
      gitHubPRClient,
      userServiceClient,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'auto',
          workerLocation: 'worker-1',
          status: 'dispatched',
        })),
        findByPR: vi.fn().mockResolvedValue(ok(null)),
        findById: vi.fn().mockResolvedValue(ok(null)),
        findByUser: vi.fn().mockResolvedValue(ok([])),
        update: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as CodeTaskRepository,
    });

    const result = await createReviewTask(deps, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-token-unavailable',
    });

    // Should still succeed - replacement comment is best-effort
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('queued');
    expect(result.value.taskId).toBe('task-review-new');

    // Verify cancel still happened even without posting replacement comment
    expect(deps.codeTaskRepo.update).toHaveBeenCalledWith(
      'task-review-existing',
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('posts replacement comment, cancels locally, then creates new task in correct order', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const taskDispatcher = {
      dispatch: vi.fn().mockResolvedValue(ok({
        dispatched: true,
        workerLocation: 'worker-1',
      })),
      cancelOnWorker: vi.fn().mockResolvedValue(undefined),
    } as unknown as TaskDispatcherService;
    const deps = createFakeDeps({
      gitHubPRClient,
      taskDispatcher,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'auto',
          workerLocation: 'worker-1',
          status: 'dispatched',
        })),
        findByPR: vi.fn().mockResolvedValue(ok(null)),
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
      eventId: 'evt-call-order',
    });

    // Verify call order using invocationCallOrder
    const commentCallOrder = vi.mocked(gitHubPRClient.postPRComment).mock.invocationCallOrder[0] ?? 0;
    const cancelCallOrder = vi.mocked(deps.codeTaskRepo.update).mock.invocationCallOrder[0] ?? 0;
    const createCallOrder = vi.mocked(deps.codeTaskRepo.create).mock.invocationCallOrder[0] ?? 0;

    // Verify sequence: comment -> cancel -> create
    expect(commentCallOrder).toBeLessThan(cancelCallOrder);
    expect(cancelCallOrder).toBeLessThan(createCallOrder);
  });

  it('replaces review task when existing task has no workerType', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const deps = createFakeDeps({
      gitHubPRClient,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          // No workerType - simulates legacy task
          workerLocation: 'worker-1',
          status: 'running',
        })),
        findByPR: vi.fn().mockResolvedValue(ok(null)),
        findById: vi.fn().mockResolvedValue(ok(null)),
        findByUser: vi.fn().mockResolvedValue(ok([])),
        update: vi.fn().mockResolvedValue(ok(undefined)),
      } as unknown as CodeTaskRepository,
    });

    const result = await createReviewTask(deps, {
      repository: 'pbuchman/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-no-worker-type',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.status).toBe('queued');
    expect(result.value.taskId).toBe('task-review-new');

    // Verify replacement was recorded in automation log without worker type
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.objectContaining({
        type: 'review_replaced',
        replacedTaskId: 'task-review-existing',
      }),
      'user-existing',
    );
  });

  it('returns worker type in result', async () => {
    const deps = createFakeDeps();

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['architecture'],
      workerType: 'qwen',
      eventId: 'evt-worker-type-result',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      status: 'queued',
      taskId: 'task-review-1',
      workerType: 'qwen',
    });
  });

  it('uses auto as default worker type in result when not specified', async () => {
    const deps = createFakeDeps();

    const result = await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-auto-worker',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      status: 'queued',
      taskId: 'task-review-1',
      workerType: 'auto',
    });
  });

  it('records replacement in automation log with existing task details', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const userServiceClient = createFakeUserServiceClient();
    const deps = createFakeDeps({
      gitHubPRClient,
      userServiceClient,
      codeTaskRepo: {
        create: vi.fn().mockResolvedValue(ok({ id: 'task-review-new' })),
        findActiveReviewForPR: vi.fn().mockResolvedValue(ok({
          id: 'task-review-existing',
          userId: 'user-existing',
          workerType: 'claude-code',
          workerLocation: 'office-mac',
          status: 'running',
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
      eventId: 'evt-replacement-comment',
    });

    // Verify replacement was recorded in automation log with existing task owner
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.objectContaining({
        type: 'review_replaced',
        replacedTaskId: 'task-review-existing',
        replacedWorkerType: 'claude-code',
      }),
      'user-existing',
    );
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
    expect(deps.taskEnqueueService.enqueue).not.toHaveBeenCalled();
  });

  it('creates task with agentType review', async () => {
    const deps = createFakeDeps();
    await createReviewTask(deps, {
      repository: 'intexuraos/intexuraos',
      prNumber: 42,
      senderLogin: 'dev-user',
      reviewTypes: ['code_quality'],
      eventId: 'evt-2',
    });

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
    expect(createCall).toBeDefined();
    if (createCall !== undefined) {
      expect(createCall[0].agentType).toBe('review');
      expect(createCall[0].systemPromptHash).toBe('review-auto');
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

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
    expect(createCall).toBeDefined();
    if (createCall !== undefined) {
      expect(createCall[0].prompt).toContain('code_quality');
      expect(createCall[0].prompt).toContain('security');
      expect(createCall[0].prompt).toContain('architecture');
    }
  });

  it('uses selected worker type for review task creation', async () => {
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

    expect(deps.taskEnqueueService.enqueue).toHaveBeenCalled();
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

    const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
    expect(createCall).toBeDefined();
    if (createCall !== undefined) {
      expect(createCall[0].prompt).toContain('Triggered by review request comment');
      expect(createCall[0].prompt).toContain('@review architecture');
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

  it('uses provided baseBranch as fallback when PR base branch fetch fails', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    vi.mocked(gitHubPRClient.getPullRequestBaseBranch).mockResolvedValue(
      err({ code: 'API_ERROR' as const, message: 'GitHub unavailable' })
    );
    const deps = createFakeDeps({ gitHubPRClient });
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
  });

  it('returns error when enqueue fails with internal_error', async () => {
    const gitHubPRClient = createFakeGitHubPRClient();
    const deps = createFakeDeps({
      gitHubPRClient,
      taskEnqueueService: {
        enqueue: vi.fn().mockResolvedValue(
          err({ code: 'internal_error' as const, message: 'Enqueue failed' })
        ),
      } as unknown as TaskEnqueueService,
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
      expect(result.error.code).toBe('internal_error');
      expect(result.error.taskId).toBe('task-review-1');
    }

    // TaskEnqueueService handles task failure marking — usecase only returns error
  });

  describe('PR notification after dispatch', () => {
    it('skips dispatch comment for review tasks (skipComment: true)', async () => {
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

      // skipComment: true means no "Task Accepted" dispatch comment is posted
      const commentCalls = vi.mocked(gitHubPRClient.postPRComment).mock.calls;
      for (const call of commentCalls) {
        const body = call[4] as string;
        expect(body).not.toContain('**Dispatch outcome:** Review task dispatched');
      }
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

    it('fails with pr_branch_unavailable when repository format is invalid (no slash)', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      const deps = createFakeDeps({ gitHubPRClient });

      const result = await createReviewTask(deps, {
        repository: 'no-slash-repo',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-invalid-repo',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('pr_branch_unavailable');
      }
    });

    it('fails with pr_branch_unavailable when GitHub token is not available', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      const userServiceClient = createFakeUserServiceClient();
      vi.mocked(userServiceClient.getOAuthToken).mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND' as const, message: 'No GitHub token' })
      );
      const deps = createFakeDeps({ gitHubPRClient, userServiceClient });

      const result = await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-no-token',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('pr_branch_unavailable');
      }
    });

    it('logs warning when updatePRTitle fails (best-effort)', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      vi.mocked(gitHubPRClient.updatePRTitle).mockResolvedValue(
        err({ code: 'UNAUTHORIZED' as const, message: 'Bad credentials' })
      );
      const deps = createFakeDeps({ gitHubPRClient });

      const result = await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-title-fail',
        prTitle: 'Fix bug',
      });

      expect(result.ok).toBe(true);
      expect(gitHubPRClient.updatePRTitle).toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 42, linearIssueId: 'INT-300' }),
        expect.stringContaining('Failed to update PR title'),
      );
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

    it('extracts linearIssueId from PR body when title has no INT tag', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-body-1',
        prTitle: 'Fix bug',
        prBody: '## Summary\nFixes INT-500\n\nSome description',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-500');
      }
      expect(deps.linearAgentClient?.createIssue).not.toHaveBeenCalled();
    });

    it('extracts linearIssueId from Linear URL in PR body when no INT-XXX text match', async () => {
      const deps = createFakeDeps();

      // Use a non-INT team prefix so Tier 2b regex doesn't match, forcing Tier 2c
      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-body-2',
        prTitle: 'Fix bug',
        prBody: '## Summary\n- Linear: https://linear.app/pbuchman/issue/TEAM-600/some-title\n\nDetails here',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('TEAM-600');
      }
      expect(deps.linearAgentClient?.createIssue).not.toHaveBeenCalled();
    });

    it('PR title match takes precedence over PR body match', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-body-3',
        prTitle: '[INT-200] Fix bug',
        prBody: 'Fixes INT-500\nhttps://linear.app/pbuchman/issue/INT-600/title',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-200');
      }
      expect(deps.linearAgentClient?.createIssue).not.toHaveBeenCalled();
    });

    it('PR body INT-XXX takes precedence over Linear URL in body', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-body-4',
        prTitle: 'Fix bug',
        prBody: 'Fixes INT-500\nhttps://linear.app/pbuchman/issue/INT-600/title',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].linearIssueId).toBe('INT-500');
      }
      expect(deps.linearAgentClient?.createIssue).not.toHaveBeenCalled();
    });

    it('PR body check is skipped when prBody is undefined', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-body-5',
        prTitle: 'Fix bug',
      });

      // Should fall through to Tier 3 (create new Linear issue)
      expect(deps.linearAgentClient?.createIssue).toHaveBeenCalled();
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

      expect(deps.linearAgentClient?.generateTitle).toHaveBeenCalledWith({
        userId: 'user-1',
        description: expect.stringContaining('Fix bug'),
      });
      expect(deps.linearAgentClient?.createIssue).toHaveBeenCalledWith({
        userId: 'user-1',
        title: 'Generated',
        description: expect.stringContaining('Review created automatically by code-agent'),
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

    it('records linear_issue_failed event when createIssue returns err', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.createIssue).mockResolvedValue(
        err({ code: 'UNAVAILABLE' as const, message: 'Usage limit exceeded' })
      );
      const deps = createFakeDeps({
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-review-1' })),
          findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
          findByPR: vi.fn().mockResolvedValue(ok(null)),
          findById: vi.fn().mockResolvedValue(ok(null)),
          findByUser: vi.fn().mockResolvedValue(ok([])),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
        linearAgentClient,
      });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-linear-fail-1',
        prTitle: 'Fix bug',
      });

      expect(deps.automationLog.record).toHaveBeenCalledWith(
        { repository: 'intexuraos/intexuraos', prNumber: 42 },
        { type: 'linear_issue_failed', error: 'Usage limit exceeded' },
        'user-1',
      );
    });

    it('records linear_issue_failed event when resolveLinearIssueId throws', async () => {
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

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-linear-fail-2',
        prTitle: 'Fix bug',
      });

      expect(deps.automationLog.record).toHaveBeenCalledWith(
        { repository: 'intexuraos/intexuraos', prNumber: 42 },
        { type: 'linear_issue_failed', error: 'Unexpected crash' },
        'user-1',
      );
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

    it('generates LLM title even when prTitle not provided', async () => {
      const deps = createFakeDeps();

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-link-7',
      });

      expect(deps.linearAgentClient?.generateTitle).toHaveBeenCalledWith({
        userId: 'user-1',
        description: expect.stringContaining('Review PR #42 in intexuraos/intexuraos'),
      });
      expect(deps.linearAgentClient?.createIssue).toHaveBeenCalledWith({
        userId: 'user-1',
        title: 'Generated',
        description: expect.stringContaining('Review created automatically by code-agent'),
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
        expect(description).toContain('## PR Review: Fix auth bug');
        expect(description).toContain('#42');
        expect(description).toContain('intexuraos/intexuraos');
        expect(description).toContain('This PR fixes the authentication bypass vulnerability in the login flow.');
        expect(description).toContain('code_quality');
        expect(description).toContain('security');
        expect(description).toContain('Review created automatically by code-agent');
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

    it('calls generateTitle with PR context for LLM title generation', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality', 'security'],
        eventId: 'evt-gen-title',
        prTitle: 'Fix auth bug',
        prBody: 'This PR fixes the authentication bypass.',
      });

      const generateCall = vi.mocked(linearAgentClient.generateTitle).mock.calls[0];
      expect(generateCall).toBeDefined();
      if (generateCall !== undefined) {
        const description = generateCall[0].description;
        expect(description).toContain('Fix auth bug');
        expect(description).toContain('authentication bypass');
        expect(description).toContain('code_quality');
        expect(description).toContain('security');
      }
    });

    it('falls back to template title when generateTitle fails', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.generateTitle).mockResolvedValue(
        err({ code: 'UNAVAILABLE' as const, message: 'LLM down' })
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-fallback-title',
        prTitle: 'Fix bug',
      });

      expect(linearAgentClient.generateTitle).toHaveBeenCalledWith({
        userId: 'user-1',
        description: expect.stringContaining('Fix bug'),
      });
      expect(linearAgentClient.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ title: '[Review] PR #42: Fix bug' })
      );
    });

    it('falls back to repository-based title when generateTitle fails and no prTitle', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.generateTitle).mockResolvedValue(
        err({ code: 'UNAVAILABLE' as const, message: 'LLM down' })
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-fallback-title-2',
      });

      expect(linearAgentClient.generateTitle).toHaveBeenCalledWith({
        userId: 'user-1',
        description: expect.stringContaining('Review PR #42 in intexuraos/intexuraos'),
      });
      expect(linearAgentClient.createIssue).toHaveBeenCalledWith(
        expect.objectContaining({ title: '[Review] PR #42 in intexuraos/intexuraos' })
      );
    });
  });

  describe('default review worker type resolution', () => {
    it('uses explicit workerType when provided, ignoring user default', async () => {
      const deps = createFakeDeps({
        workerSettingsRepo: {
          ...createFakeWorkerSettingsRepo(),
          getSettings: vi.fn().mockResolvedValue(ok({
            workers: [{
              name: 'worker-1',
              url: 'https://worker.example.com',
              cfAccessClientId: 'cf-id',
              cfAccessClientSecret: 'cf-secret',
              dispatchSigningSecret: 'dispatch-secret',
              enabled: true,
            }],
            defaultReviewWorkerType: 'glm',
          })),
        } as unknown as WorkerSettingsRepository,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        workerType: 'opus',
        eventId: 'evt-explicit-wt',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerType).toBe('opus');
      }
    });

    it('uses user default when workerType is undefined', async () => {
      const deps = createFakeDeps({
        workerSettingsRepo: {
          ...createFakeWorkerSettingsRepo(),
          getSettings: vi.fn().mockResolvedValue(ok({
            workers: [{
              name: 'worker-1',
              url: 'https://worker.example.com',
              cfAccessClientId: 'cf-id',
              cfAccessClientSecret: 'cf-secret',
              dispatchSigningSecret: 'dispatch-secret',
              enabled: true,
            }],
            defaultReviewWorkerType: 'glm',
          })),
        } as unknown as WorkerSettingsRepository,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-default-wt',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerType).toBe('glm');
      }
    });

    it('falls back to auto when no user default is set', async () => {
      const deps = createFakeDeps({
        workerSettingsRepo: {
          ...createFakeWorkerSettingsRepo(),
          getSettings: vi.fn().mockResolvedValue(ok({
            workers: [{
              name: 'worker-1',
              url: 'https://worker.example.com',
              cfAccessClientId: 'cf-id',
              cfAccessClientSecret: 'cf-secret',
              dispatchSigningSecret: 'dispatch-secret',
              enabled: true,
            }],
          })),
        } as unknown as WorkerSettingsRepository,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-no-default',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerType).toBe('auto');
      }
    });

    it('falls back to auto when getSettings fails', async () => {
      const deps = createFakeDeps({
        workerSettingsRepo: {
          ...createFakeWorkerSettingsRepo(),
          getSettings: vi.fn().mockResolvedValue(err({
            code: 'internal_error',
            message: 'Firestore error',
          })),
        } as unknown as WorkerSettingsRepository,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-settings-fail',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.workerType).toBe('auto');
      }
    });
  });

  describe('enqueue error handling', () => {
    it('returns queue_full when enqueue returns queue_full', async () => {
      const deps = createFakeDeps({
        taskEnqueueService: {
          enqueue: vi.fn().mockResolvedValue(err({ code: 'queue_full', message: 'Queue is full' })),
        } as unknown as TaskEnqueueService,
        codeTaskRepo: {
          create: vi.fn().mockResolvedValue(ok({ id: 'task-full-1' })),
          findActiveReviewForPR: vi.fn().mockResolvedValue(ok(null)),
          findByPR: vi.fn().mockResolvedValue(ok(null)),
          update: vi.fn().mockResolvedValue(ok(undefined)),
        } as unknown as CodeTaskRepository,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 51,
        senderLogin: 'dev-user',
        reviewTypes: ['security'],
        eventId: 'evt-full-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
        expect(result.error.taskId).toBe('task-full-1');
      }

      // TaskEnqueueService handles task failure marking — usecase only returns error
    });

    it('returns internal_error when enqueue returns internal_error', async () => {
      const deps = createFakeDeps({
        taskEnqueueService: {
          enqueue: vi.fn().mockResolvedValue(err({ code: 'internal_error', message: 'Something went wrong' })),
        } as unknown as TaskEnqueueService,
      });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 52,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-internal-1',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('internal_error');
        expect(result.error.message).toBe('Something went wrong');
      }

      // TaskEnqueueService handles task failure marking — usecase only returns error
    });
  });

  describe('issue description and plan path in review prompt', () => {
    it('user prompt emphasizes requirements validation when issue description is present', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.getIssueDescription).mockResolvedValue(
        ok('Implement feature X.\n\nPlan document: docs/plans/2026-03-20-feature-x.md')
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-emphasis-1',
        prTitle: '[INT-300] Implement feature X',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).toContain('CRITICAL: Verify every requirement below');
        expect(createCall[0].prompt).toContain('### Issue Requirements');
        expect(createCall[0].prompt).toContain('Missing or partially implemented requirements are 🔴 findings.');
      }
    });

    it('does not include requirements emphasis when issue description is absent', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.getIssueDescription).mockResolvedValue(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear is down' })
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-emphasis-2',
        prTitle: '[INT-300] Fix bug',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).not.toContain('CRITICAL: Verify every requirement below');
      }
    });

    it('embeds issue description and plan path in review prompt', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.getIssueDescription).mockResolvedValue(
        ok('Implement feature X.\n\nPlan document: docs/plans/2026-03-20-feature-x.md')
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-desc-1',
        prTitle: '[INT-300] Implement feature X',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).toContain('### Issue Requirements');
        expect(createCall[0].prompt).toContain('Implement feature X.');
        expect(createCall[0].prompt).toContain('### Plan Document');
        expect(createCall[0].prompt).toContain('docs/plans/2026-03-20-feature-x.md');
      }
    });

    it('embeds issue description without plan section when no plan reference', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.getIssueDescription).mockResolvedValue(
        ok('Fix the login bug on mobile.')
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-desc-2',
        prTitle: '[INT-300] Fix login bug',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).toContain('### Issue Requirements');
        expect(createCall[0].prompt).toContain('Fix the login bug on mobile.');
        expect(createCall[0].prompt).not.toContain('### Plan Document');
      }
    });

    it('truncates long issue descriptions in review prompt', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      const longDescription = 'A'.repeat(5000);
      vi.mocked(linearAgentClient.getIssueDescription).mockResolvedValue(
        ok(longDescription)
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-desc-trunc',
        prTitle: '[INT-300] Big issue',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).toContain('### Issue Requirements');
        expect(createCall[0].prompt).not.toContain(longDescription);
        expect(createCall[0].prompt).toContain('Truncated');
        expect(createCall[0].prompt).toContain('full description available in the Linear issue');
      }
    });

    it('uses created description directly for Tier 3 issues without fetching from Linear', async () => {
      // Tier 3: createIssue succeeds — getIssueDescription should NOT be called
      // because the description is already available from the create call
      const linearAgentClient = createFakeLinearAgentClient();
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality', 'security'],
        eventId: 'evt-desc-fallback',
        prTitle: 'Fix auth bug',
        prBody: 'This PR fixes the authentication bypass.',
      });

      // Tier 3 should have been used (no existing task, no INT-XXX in title/body)
      expect(linearAgentClient.createIssue).toHaveBeenCalled();
      expect(linearAgentClient.getIssueDescription).not.toHaveBeenCalled();

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        // The fallback description from buildLinearIssueDescription should be embedded
        expect(createCall[0].prompt).toContain('### Issue Requirements');
        expect(createCall[0].prompt).toContain('## PR Review: Fix auth bug');
        expect(createCall[0].prompt).toContain('This PR fixes the authentication bypass.');
      }
    });

    it('creates prompt without requirements when getIssueDescription fails', async () => {
      const linearAgentClient = createFakeLinearAgentClient();
      vi.mocked(linearAgentClient.getIssueDescription).mockResolvedValue(
        err({ code: 'UNAVAILABLE' as const, message: 'Linear is down' })
      );
      const deps = createFakeDeps({ linearAgentClient });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-desc-3',
        prTitle: '[INT-300] Fix bug',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).not.toContain('### Issue Requirements');
      }
    });
  });

  describe('re-review context injection', () => {
    it('includes re-review context when lastReviewedCommitSha is present', async () => {
      const gitHubPRSummaryRepo = createFakeGitHubPRSummaryRepo('abc1234');
      const deps = createFakeDeps({ gitHubPRSummaryRepo });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-rereview-1',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).toContain('## Re-review Context');
        expect(createCall[0].prompt).toContain('abc1234');
        expect(createCall[0].prompt).toContain('abc1234..HEAD');
        expect(createCall[0].prompt).toContain('Do NOT re-flag findings from the previous review');
      }
    });

    it('does not include re-review context when lastReviewedCommitSha is null', async () => {
      const gitHubPRSummaryRepo = createFakeGitHubPRSummaryRepo(null);
      const deps = createFakeDeps({ gitHubPRSummaryRepo });

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-rereview-2',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).not.toContain('## Re-review Context');
      }
    });

    it('does not include re-review context when gitHubPRSummaryRepo is not provided', async () => {
      const deps = createFakeDeps();
      // Default deps have no gitHubPRSummaryRepo

      await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-rereview-3',
      });

      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).not.toContain('## Re-review Context');
      }
    });

    it('continues without re-review context when findByPullRequest fails', async () => {
      const gitHubPRSummaryRepo = createFakeGitHubPRSummaryRepo(null);
      vi.mocked(gitHubPRSummaryRepo.findByPullRequest).mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR' as const, message: 'DB error' })
      );
      const deps = createFakeDeps({ gitHubPRSummaryRepo });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-rereview-4',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).not.toContain('## Re-review Context');
      }
    });

    it('continues without re-review context when findByPullRequest returns null', async () => {
      const gitHubPRSummaryRepo = createFakeGitHubPRSummaryRepo(null);
      vi.mocked(gitHubPRSummaryRepo.findByPullRequest).mockResolvedValue(ok(null));
      const deps = createFakeDeps({ gitHubPRSummaryRepo });

      const result = await createReviewTask(deps, {
        repository: 'intexuraos/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-rereview-5',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prompt).not.toContain('## Re-review Context');
      }
    });
  });

  describe('PR branch resolution (INT-1258)', () => {
    it('sets prBranch from PR headRef via getPullRequestStatus', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      vi.mocked(gitHubPRClient.getPullRequestStatus).mockResolvedValue(
        ok({ state: 'open' as const, mergedAt: null, headRef: 'fix/INT-123-auth' })
      );
      const deps = createFakeDeps({ gitHubPRClient });

      const result = await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-branch-1',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].prBranch).toBe('fix/INT-123-auth');
      }
    });

    it('sets baseBranch from PR baseRefName via getPullRequestBaseBranch', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      vi.mocked(gitHubPRClient.getPullRequestBaseBranch).mockResolvedValue(ok('development'));
      const deps = createFakeDeps({ gitHubPRClient });

      const result = await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-branch-2',
      });

      expect(result.ok).toBe(true);
      const createCall = vi.mocked(deps.codeTaskRepo.create).mock.calls[0];
      expect(createCall).toBeDefined();
      if (createCall !== undefined) {
        expect(createCall[0].baseBranch).toBe('development');
      }
    });

    it('fails with pr_branch_unavailable when getPullRequestStatus fails', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      vi.mocked(gitHubPRClient.getPullRequestStatus).mockResolvedValue(
        err({ code: 'API_ERROR' as const, message: 'GitHub down' })
      );
      vi.mocked(gitHubPRClient.getPullRequestBaseBranch).mockResolvedValue(
        err({ code: 'API_ERROR' as const, message: 'GitHub down' })
      );
      const deps = createFakeDeps({ gitHubPRClient });

      const result = await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-branch-3',
        baseBranch: 'development',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('pr_branch_unavailable');
        expect(result.error.message).toContain('PR #42');
      }
      expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    });

    it('fails with pr_branch_unavailable when GitHub token is unavailable', async () => {
      const gitHubPRClient = createFakeGitHubPRClient();
      vi.mocked(gitHubPRClient.getPullRequestStatus).mockResolvedValue(
        err({ code: 'API_ERROR' as const, message: 'GitHub down' })
      );
      vi.mocked(gitHubPRClient.getPullRequestBaseBranch).mockResolvedValue(
        err({ code: 'API_ERROR' as const, message: 'GitHub down' })
      );
      const userServiceClient = createFakeUserServiceClient();
      vi.mocked(userServiceClient.getOAuthToken).mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND', message: 'No token' }) as never
      );
      const deps = createFakeDeps({ gitHubPRClient, userServiceClient });

      const result = await createReviewTask(deps, {
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        senderLogin: 'dev-user',
        reviewTypes: ['code_quality'],
        eventId: 'evt-branch-4',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('pr_branch_unavailable');
      }
      expect(deps.codeTaskRepo.create).not.toHaveBeenCalled();
    });
  });
});
