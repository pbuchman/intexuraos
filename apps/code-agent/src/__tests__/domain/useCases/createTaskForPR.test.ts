/**
 * Tests for createTaskForPR use case.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import pino from 'pino';
import { createTaskForPR, type CreateTaskForPRDeps, type CreateTaskForPRRequest } from '../../../domain/usecases/createTaskForPR.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { UserLookupService } from '../../../domain/ports/userLookupService.js';
import type { LinearIssueService, EnsureIssueResult } from '../../../domain/services/linearIssueService.js';
import type { TaskEnqueueService } from '../../../domain/services/taskEnqueueService.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';

const logger = pino({ level: 'silent' }) as unknown as Logger;

function createMockUserLookupService(): UserLookupService {
  return {
    async resolveByGitHubUsername(): ReturnType<UserLookupService['resolveByGitHubUsername']> {
      return ok({
        userId: 'user-123',
        worker: {
          name: 'home-mac',
          url: 'https://worker.example.com',
          cfAccessClientId: 'client-id',
          cfAccessClientSecret: 'client-secret',
          dispatchSigningSecret: 'dispatch-secret',
          enabled: true,
        },
      });
    },
  };
}

function createMockLinearIssueService(): LinearIssueService {
  return {
    async ensureIssueExists(): Promise<EnsureIssueResult> {
      return {
        linearIssueId: 'INT-100',
        linearIssueTitle: 'Test Issue',
        linearFallback: false,
        linearIssueLabels: ['code-task'],
        hasChildren: false,
        linearIssueUrl: 'https://linear.app/intexura/issue/INT-100',
      };
    },
    async markInProgress(): Promise<void> { return; },
    async markInReview(): Promise<void> { return; },
    async markTodo(): Promise<void> { return; },
    async markQa(): Promise<void> { return; },
    async removeLabel(): Promise<void> { return; },
    async addLabel(): Promise<void> { return; },
  };
}

function createMockCodeTaskRepo(): CodeTaskRepository {
  return {
    async create(_input, _options): ReturnType<CodeTaskRepository['create']> {
      return ok({} as never);
    },
    async findById(): ReturnType<CodeTaskRepository['findById']> {
      return err({ code: 'NOT_FOUND', message: 'not found' });
    },
    async findByIdForUser(): ReturnType<CodeTaskRepository['findByIdForUser']> {
      return err({ code: 'NOT_FOUND', message: 'not found' });
    },
    async update(): ReturnType<CodeTaskRepository['update']> {
      return ok({} as never);
    },
    async list(): ReturnType<CodeTaskRepository['list']> {
      return ok({ tasks: [], total: 0 });
    },
    async hasActiveTaskForLinearIssue(): ReturnType<CodeTaskRepository['hasActiveTaskForLinearIssue']> {
      return ok({ hasActive: false });
    },
    async findZombieTasks(): ReturnType<CodeTaskRepository['findZombieTasks']> {
      return ok([]);
    },
    async countByUserToday(): ReturnType<CodeTaskRepository['countByUserToday']> {
      return ok(0);
    },
    async findArchivableTasks(): ReturnType<CodeTaskRepository['findArchivableTasks']> {
      return ok([]);
    },
    async archiveTaskLogs(): ReturnType<CodeTaskRepository['archiveTaskLogs']> {
      return ok({ logCount: 0, archivedAt: new Date() });
    },
    async findByPR(): ReturnType<CodeTaskRepository['findByPR']> {
      return ok(null);
    },
    async findActiveReviewForPR(): ReturnType<CodeTaskRepository['findActiveReviewForPR']> {
      return ok(null);
    },
    async hasDispatchedOrRunningForPR(): ReturnType<CodeTaskRepository['hasDispatchedOrRunningForPR']> {
      return ok({ hasActive: false });
    },
    async deleteTask(): ReturnType<CodeTaskRepository['deleteTask']> {
      return ok(undefined);
    },
    async listQueuedByAge(): ReturnType<CodeTaskRepository['listQueuedByAge']> {
      return ok([]);
    },
    async listQueued(): ReturnType<CodeTaskRepository['listQueued']> {
      return ok([]);
    },
    async listPendingExecutionMemoryPostRun(): ReturnType<CodeTaskRepository['listPendingExecutionMemoryPostRun']> {
      return ok([]);
    },
    async countQueued(): ReturnType<CodeTaskRepository['countQueued']> {
      return ok(0);
    },
    async findRecentTasksByLinearIssue(): ReturnType<CodeTaskRepository['findRecentTasksByLinearIssue']> {
      return ok([]);
    },
    async findPlannedTaskByLinearIssue(): ReturnType<CodeTaskRepository['findPlannedTaskByLinearIssue']> {
      return ok(null);
    },
    async findLatestExecutionTaskByPR(): ReturnType<CodeTaskRepository['findLatestExecutionTaskByPR']> {
      return ok(null);
    },
    async findOriginTaskByPR(): ReturnType<CodeTaskRepository['findOriginTaskByPR']> {
      return ok(null);
    },
    async findRecentRemediationForPR(): ReturnType<CodeTaskRepository['findRecentRemediationForPR']> {
      return ok(null);
    },
    async findPreservedPullRequestTask(): ReturnType<CodeTaskRepository['findPreservedPullRequestTask']> {
      return ok(null);
    },
    async listAllNonArchived(): ReturnType<CodeTaskRepository['listAllNonArchived']> {
      return ok([]);
    },
    async listAllNonArchivedGlobal(): ReturnType<CodeTaskRepository['listAllNonArchivedGlobal']> {
      return ok([]);
    },
  };
}

function createMockTaskEnqueueService(): TaskEnqueueService {
  return {
    async enqueue(): ReturnType<TaskEnqueueService['enqueue']> {
      return ok({ taskId: 'task_mock', queuePosition: 1 });
    },
  };
}

function createMockWhatsAppNotifier(): WhatsAppNotifier {
  return {
    async notifyTaskComplete(): ReturnType<WhatsAppNotifier['notifyTaskComplete']> {
      return ok(undefined);
    },
    async notifyTaskFailed(): ReturnType<WhatsAppNotifier['notifyTaskFailed']> {
      return ok(undefined);
    },
    async notifyTaskStarted(): ReturnType<WhatsAppNotifier['notifyTaskStarted']> {
      return ok(undefined);
    },
    async notifyTaskResumed(): ReturnType<WhatsAppNotifier['notifyTaskResumed']> {
      return ok(undefined);
    },
    async notifyResumedTaskComplete(): ReturnType<WhatsAppNotifier['notifyResumedTaskComplete']> {
      return ok(undefined);
    },
    async notifyDesignComplete(): ReturnType<WhatsAppNotifier['notifyDesignComplete']> {
      return ok(undefined);
    },
    async notifyTaskQueued(): ReturnType<WhatsAppNotifier['notifyTaskQueued']> {
      return ok(undefined);
    },
    async notifyTaskQueueExpired(): ReturnType<WhatsAppNotifier['notifyTaskQueueExpired']> {
      return ok(undefined);
    },
    async notifyDispatchRetryExhausted(): ReturnType<WhatsAppNotifier['notifyDispatchRetryExhausted']> {
      return ok(undefined);
    },
    async notifyCIFailure(): ReturnType<WhatsAppNotifier['notifyCIFailure']> {
      return ok(undefined);
    },
  };
}

function createMockGitHubPRClient(): GitHubPRClient {
  return {
    async updatePRTitle(): ReturnType<GitHubPRClient['updatePRTitle']> {
      return ok(undefined);
    },
    async getPullRequestFiles(): ReturnType<GitHubPRClient['getPullRequestFiles']> {
      return ok([]);
    },
    async getPullRequestCommits(): ReturnType<GitHubPRClient['getPullRequestCommits']> {
      return ok([]);
    },
    async getPullRequestBaseBranch(): ReturnType<GitHubPRClient['getPullRequestBaseBranch']> {
      return ok('main');
    },
    async getPullRequestStatus(): ReturnType<GitHubPRClient['getPullRequestStatus']> {
      return ok({ state: 'open', mergedAt: null, headRef: 'task_existing_pr_branch' });
    },
    async postPRComment(): ReturnType<GitHubPRClient['postPRComment']> {
      return ok({ commentId: 1 });
    },
    async listOpenPullRequestsByBaseBranch(): ReturnType<GitHubPRClient['listOpenPullRequestsByBaseBranch']> {
      return ok([]);
    },
    async getPullRequestDetails(): ReturnType<GitHubPRClient['getPullRequestDetails']> {
      return ok({
        number: 1,
        title: 'Test PR',
        body: null,
        state: 'open',
        authorLogin: 'alice',
        baseBranch: 'main',
        headBranch: 'feature/test',
        mergeable: true,
        mergeableState: 'clean',
        headSha: 'sha123',
      });
    },
    async getIssueComment(): ReturnType<GitHubPRClient['getIssueComment']> {
      return ok({ body: '' });
    },
    async updateIssueComment(): ReturnType<GitHubPRClient['updateIssueComment']> {
      return ok({ commentId: 1 });
    },
    async mergePullRequest(): ReturnType<GitHubPRClient['mergePullRequest']> {
      return ok({ sha: 'abc123', merged: true });
    },
    async getCombinedCheckStatus(): ReturnType<GitHubPRClient['getCombinedCheckStatus']> {
      return ok({ state: 'success' });
    },
    async listAllOpenPullRequests(): ReturnType<GitHubPRClient['listAllOpenPullRequests']> {
      return ok([]);
    },
  };
}

function createMockUserServiceClient(): UserServiceClient {
  return {
    async getApiKeys(): ReturnType<UserServiceClient['getApiKeys']> {
      return ok({});
    },
    async getLlmClient(): ReturnType<UserServiceClient['getLlmClient']> {
      return err({ code: 'NO_API_KEY', message: 'mock' }) as never;
    },
    async reportLlmSuccess(): Promise<void> { return; },
    async getOAuthToken(): ReturnType<UserServiceClient['getOAuthToken']> {
      return ok({ accessToken: 'ghp_test_token_123', email: 'test@example.com' });
    },
    async resolveGitHubUsername(): ReturnType<UserServiceClient['resolveGitHubUsername']> {
      return ok(null);
    },
    async getUserTimezone(): Promise<string | undefined> {
      return undefined;
    },
  };
}

const mockLockDeleteFn = vi.fn().mockResolvedValue(undefined);

function mockDoc(): never {
  return { delete: mockLockDeleteFn } as never;
}

function createMockFirestore(): CreateTaskForPRDeps['firestore'] {
  return {
    async runTransaction<T>(fn: (transaction: never) => Promise<T>): Promise<T> {
      const mockTransaction = {
        get: async (): Promise<{ exists: boolean; data: () => null }> => ({ exists: false, data: (): null => null }),
        set: (): void => undefined,
      };
      return fn(mockTransaction as never);
    },
    doc: mockDoc,
  };
}

function createFakeWorkerSettingsRepo(overrides?: Partial<WorkerSettingsRepository>): WorkerSettingsRepository {
  return {
    getSettings: vi.fn().mockResolvedValue(ok(null)),
    ...overrides,
  } as unknown as WorkerSettingsRepository;
}

function createDefaultDeps(): CreateTaskForPRDeps {
  return {
    logger,
    codeTaskRepo: createMockCodeTaskRepo(),
    userLookupService: createMockUserLookupService(),
    linearIssueService: createMockLinearIssueService(),
    taskEnqueueService: createMockTaskEnqueueService(),
    whatsappNotifier: createMockWhatsAppNotifier(),
    orchestratorSecret: 'test-secret',
    gitHubPRClient: createMockGitHubPRClient(),
    userServiceClient: createMockUserServiceClient(),
    firestore: createMockFirestore(),
    automationLog: { record: vi.fn().mockResolvedValue(undefined) },
    workerSettingsRepo: createFakeWorkerSettingsRepo(),
  };
}

function createDefaultRequest(): CreateTaskForPRRequest {
  return {
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    prTitle: 'Fix the bug',
    senderLogin: 'testuser',
    comment: 'Please review this PR',
    eventId: 'event-123',
  };
}

describe('createTaskForPR', () => {
  let deps: CreateTaskForPRDeps;
  let request: CreateTaskForPRRequest;

  beforeEach(() => {
    mockLockDeleteFn.mockClear();
    deps = createDefaultDeps();
    request = createDefaultRequest();
  });

  it('creates a task and enqueues it successfully', async () => {
    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskId).toMatch(/^task_/);
    }
  });

  it('persists only linearIssueId from linearResult in createInput', async () => {
    let capturedCreateInput: Record<string, unknown> = {};

    deps.codeTaskRepo = {
      ...createMockCodeTaskRepo(),
      async create(input): ReturnType<CodeTaskRepository['create']> {
        capturedCreateInput = input as unknown as Record<string, unknown>;
        return ok({} as never);
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedCreateInput['linearIssueId']).toBe('INT-100');
    expect(capturedCreateInput).not.toHaveProperty('linearIssueTitle');
    expect(capturedCreateInput).not.toHaveProperty('linearIssueUrl');
    expect(capturedCreateInput).not.toHaveProperty('linearIssueLabels');
    expect(capturedCreateInput).not.toHaveProperty('linearFallback');
  });

  it('persists pull_request agentType and full prompt context for queued redispatch', async () => {
    let capturedCreateInput: Record<string, unknown> = {};

    deps.codeTaskRepo = {
      ...createMockCodeTaskRepo(),
      async create(input): ReturnType<CodeTaskRepository['create']> {
        capturedCreateInput = input as unknown as Record<string, unknown>;
        return ok({} as never);
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedCreateInput['agentType']).toBe('pull_request');
    expect(capturedCreateInput['sanitizedPrompt']).toEqual(expect.any(String));
    expect(String(capturedCreateInput['sanitizedPrompt'])).toContain(
      '[PR Comment Task] Comment on PR #42 in pbuchman/intexuraos'
    );
    expect(String(capturedCreateInput['sanitizedPrompt'])).toContain('The commenter said:');
    expect(String(capturedCreateInput['sanitizedPrompt'])).toContain('Please review this PR');
    expect(capturedCreateInput['sanitizedPrompt']).not.toBe('Please review this PR');
  });

  it('stores workerLocation as queued in createInput', async () => {
    let capturedCreateInput: Record<string, unknown> = {};

    deps.codeTaskRepo = {
      ...createMockCodeTaskRepo(),
      async create(input): ReturnType<CodeTaskRepository['create']> {
        capturedCreateInput = input as unknown as Record<string, unknown>;
        return ok({} as never);
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedCreateInput['workerLocation']).toBe('queued');
  });

  it('stores trackingCommentId in createInput when provided in request', async () => {
    let capturedCreateInput: Record<string, unknown> = {};

    deps.codeTaskRepo = {
      ...createMockCodeTaskRepo(),
      async create(input): ReturnType<CodeTaskRepository['create']> {
        capturedCreateInput = input as unknown as Record<string, unknown>;
        return ok({} as never);
      },
    };

    request.trackingCommentId = '98765';
    await createTaskForPR(deps, request);

    expect(capturedCreateInput['trackingCommentId']).toBe('98765');
  });

  it('omits trackingCommentId from createInput when not provided in request', async () => {
    let capturedCreateInput: Record<string, unknown> = {};

    deps.codeTaskRepo = {
      ...createMockCodeTaskRepo(),
      async create(input): ReturnType<CodeTaskRepository['create']> {
        capturedCreateInput = input as unknown as Record<string, unknown>;
        return ok({} as never);
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedCreateInput).not.toHaveProperty('trackingCommentId');
  });

  it('returns user_not_found when user lookup fails with USER_NOT_FOUND', async () => {
    deps.userLookupService = {
      async resolveByGitHubUsername(): ReturnType<UserLookupService['resolveByGitHubUsername']> {
        return err({ code: 'USER_NOT_FOUND', message: 'No user found' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('user_not_found');
    }
  });

  it('returns no_workers_configured when user has no enabled workers', async () => {
    deps.userLookupService = {
      async resolveByGitHubUsername(): ReturnType<UserLookupService['resolveByGitHubUsername']> {
        return err({ code: 'NO_ENABLED_WORKER', message: 'No enabled workers' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('no_workers_configured');
    }
  });

  it('returns internal_error when user lookup has internal error', async () => {
    deps.userLookupService = {
      async resolveByGitHubUsername(): ReturnType<UserLookupService['resolveByGitHubUsername']> {
        return err({ code: 'INTERNAL_ERROR', message: 'Firestore error' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
  });

  it('returns existing task ID when lock document already exists', async () => {
    deps.firestore = {
      async runTransaction<T>(fn: (transaction: never) => Promise<T>): Promise<T> {
        const mockTransaction = {
          get: async (): Promise<{ exists: boolean; data: () => { taskId: string } }> => ({
            exists: true,
            data: (): { taskId: string } => ({ taskId: 'existing-task-id' }),
          }),
          set: (): void => undefined,
        };
        return fn(mockTransaction as never);
      },
      doc: mockDoc,
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.taskId).toBe('existing-task-id');
    }
  });

  it('returns task_creation_failed when lock document has no taskId', async () => {
    deps.firestore = {
      async runTransaction<T>(fn: (transaction: never) => Promise<T>): Promise<T> {
        const mockTransaction = {
          get: async (): Promise<{ exists: boolean; data: () => Record<string, never> }> => ({
            exists: true,
            data: (): Record<string, never> => ({}),
          }),
          set: (): void => undefined,
        };
        return fn(mockTransaction as never);
      },
      doc: mockDoc,
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_creation_failed');
    }
  });

  it('returns internal_error when transaction throws', async () => {
    deps.firestore = {
      async runTransaction(): Promise<never> {
        throw new Error('Firestore transaction failed');
      },
      doc: mockDoc,
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
      expect(result.error.message).toContain('Firestore transaction failed');
    }
  });

  it('updates PR title with Linear issue ID using per-user OAuth token', async () => {
    let capturedToken = '';
    let capturedNewTitle = '';

    deps.gitHubPRClient = {
      ...createMockGitHubPRClient(),
      async updatePRTitle(token, _owner, _repo, _prNumber, newTitle): ReturnType<GitHubPRClient['updatePRTitle']> {
        capturedToken = token;
        capturedNewTitle = newTitle;
        return ok(undefined);
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedToken).toBe('ghp_test_token_123');
    expect(capturedNewTitle).toBe('[INT-100] Fix the bug');
  });

  it('skips PR title update when GitHub OAuth token is not available', async () => {
    let prTitleUpdateCalled = false;

    deps.userServiceClient = {
      ...createMockUserServiceClient(),
      async getOAuthToken(): ReturnType<UserServiceClient['getOAuthToken']> {
        return err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub connection' });
      },
    };

    deps.gitHubPRClient = {
      ...createMockGitHubPRClient(),
      async updatePRTitle(): ReturnType<GitHubPRClient['updatePRTitle']> {
        prTitleUpdateCalled = true;
        return ok(undefined);
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
    expect(prTitleUpdateCalled).toBe(false);
  });

  it('skips PR title update when prTitle is not provided', async () => {
    let prTitleUpdateCalled = false;

    deps.gitHubPRClient = {
      ...createMockGitHubPRClient(),
      async updatePRTitle(): ReturnType<GitHubPRClient['updatePRTitle']> {
        prTitleUpdateCalled = true;
        return ok(undefined);
      },
    };

    // Use a request without prTitle (exactOptionalPropertyTypes)
    const noPrTitleRequest: CreateTaskForPRRequest = {
      repository: request.repository,
      prNumber: request.prNumber,
      senderLogin: request.senderLogin,
      comment: request.comment,
      eventId: request.eventId,
    };

    const result = await createTaskForPR(deps, noPrTitleRequest);

    expect(result.ok).toBe(true);
    expect(prTitleUpdateCalled).toBe(false);
  });

  it('skips PR title update when PR already has Linear issue ID in title', async () => {
    let prTitleUpdateCalled = false;

    deps.gitHubPRClient = {
      ...createMockGitHubPRClient(),
      async updatePRTitle(): ReturnType<GitHubPRClient['updatePRTitle']> {
        prTitleUpdateCalled = true;
        return ok(undefined);
      },
    };

    request.prTitle = '[INT-200] Already linked PR';

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
    expect(prTitleUpdateCalled).toBe(false);
  });

  it('continues successfully when PR title update fails (best-effort)', async () => {
    deps.gitHubPRClient = {
      ...createMockGitHubPRClient(),
      async updatePRTitle(): ReturnType<GitHubPRClient['updatePRTitle']> {
        return err({ code: 'API_ERROR', message: 'GitHub API error' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
  });

  it('records automation log after enqueue is accepted', async () => {
    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'task_dispatched', agentType: 'pull_request' }),
      expect.any(String),
    );
  });

  it('includes workerType in automation log after enqueue when provided', async () => {
    request.workerType = 'qwen';

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      expect.objectContaining({ type: 'task_dispatched', workerType: 'qwen', agentType: 'pull_request' }),
      expect.any(String),
    );
  });

  it('returns enqueue error code when enqueue fails with queue_full', async () => {
    deps.taskEnqueueService = {
      async enqueue(): ReturnType<TaskEnqueueService['enqueue']> {
        return err({ code: 'queue_full', message: 'Queue is full' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('queue_full');
      expect(result.error.message).toBe('Queue is full');
    }
  });

  it('returns enqueue error code when enqueue fails with internal_error', async () => {
    deps.taskEnqueueService = {
      async enqueue(): ReturnType<TaskEnqueueService['enqueue']> {
        return err({ code: 'internal_error', message: 'Unexpected failure' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal_error');
    }
  });

  it('returns enqueue error code when enqueue fails with task_not_found', async () => {
    deps.taskEnqueueService = {
      async enqueue(): ReturnType<TaskEnqueueService['enqueue']> {
        return err({ code: 'task_not_found', message: 'Task not found' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_not_found');
    }
  });

  it('returns task_creation_failed when codeTaskRepo.create fails', async () => {
    deps.codeTaskRepo = {
      ...createMockCodeTaskRepo(),
      async create(): ReturnType<CodeTaskRepository['create']> {
        return err({ code: 'ACTIVE_TASK_EXISTS', message: 'Task already exists', existingTaskId: 'existing-123' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_creation_failed');
    }
  });

  it('skips PR title update when repository format is invalid', async () => {
    let prTitleUpdateCalled = false;

    deps.gitHubPRClient = {
      ...createMockGitHubPRClient(),
      async updatePRTitle(): ReturnType<GitHubPRClient['updatePRTitle']> {
        prTitleUpdateCalled = true;
        return ok(undefined);
      },
    };

    // Repository without owner/repo format (no slash)
    request.repository = 'noslash';

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
    expect(prTitleUpdateCalled).toBe(false);
  });

  it('logs warning when Linear falls back to non-Linear mode', async () => {
    deps.linearIssueService = {
      ...createMockLinearIssueService(),
      async ensureIssueExists(): Promise<EnsureIssueResult> {
        return {
          linearIssueTitle: 'Fallback task',
          linearFallback: true,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        };
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(true);
  });

  it('records linear_issue_failed event when linearFallback is true with error', async () => {
    deps.linearIssueService = {
      ...createMockLinearIssueService(),
      async ensureIssueExists(): Promise<EnsureIssueResult> {
        return {
          linearIssueTitle: 'Fallback task',
          linearFallback: true,
          linearFallbackError: 'Usage limit exceeded',
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        };
      },
    };

    await createTaskForPR(deps, request);

    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      { type: 'linear_issue_failed', error: 'Usage limit exceeded' },
      'user-123',
    );
  });

  it('records linear_issue_failed event with default message when linearFallbackError is undefined', async () => {
    deps.linearIssueService = {
      ...createMockLinearIssueService(),
      async ensureIssueExists(): Promise<EnsureIssueResult> {
        return {
          linearIssueTitle: 'Fallback task',
          linearFallback: true,
          linearIssueLabels: ['code-task'],
          hasChildren: false,
        };
      },
    };

    await createTaskForPR(deps, request);

    expect(deps.automationLog.record).toHaveBeenCalledWith(
      { repository: 'pbuchman/intexuraos', prNumber: 42 },
      { type: 'linear_issue_failed', error: 'Linear unavailable' },
      'user-123',
    );
  });

  it('calls taskEnqueueService.enqueue with correct taskId and userId', async () => {
    let capturedInput: { taskId: string; userId: string } | undefined;

    deps.taskEnqueueService = {
      async enqueue(input): ReturnType<TaskEnqueueService['enqueue']> {
        capturedInput = input;
        return ok({ taskId: input.taskId, queuePosition: 1 });
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedInput).toBeDefined();
    expect(capturedInput?.taskId).toMatch(/^task_/);
    expect(capturedInput?.userId).toBe('user-123');
  });

  describe('baseBranch API fetch (Layer 2)', () => {
    it('should fetch baseBranch from GitHub API when not in request', async () => {
      let capturedBaseBranch = '';

      deps.gitHubPRClient = {
        ...createMockGitHubPRClient(),
        async getPullRequestBaseBranch(): ReturnType<GitHubPRClient['getPullRequestBaseBranch']> {
          return ok('development');
        },
      };

      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async create(input): ReturnType<CodeTaskRepository['create']> {
          capturedBaseBranch = (input as unknown as Record<string, string>)['baseBranch'] ?? '';
          return ok({} as never);
        },
      };

      // Use request without baseBranch
      const noBranchRequest: CreateTaskForPRRequest = {
        repository: request.repository,
        prNumber: request.prNumber,
        prTitle: 'Fix the bug',
        senderLogin: request.senderLogin,
        comment: request.comment,
        eventId: request.eventId,
      };

      await createTaskForPR(deps, noBranchRequest);

      expect(capturedBaseBranch).toBe('development');
    });

    it('should not fetch baseBranch when already provided in request', async () => {
      let getPullRequestBaseBranchCalled = false;

      deps.gitHubPRClient = {
        ...createMockGitHubPRClient(),
        async getPullRequestBaseBranch(): ReturnType<GitHubPRClient['getPullRequestBaseBranch']> {
          getPullRequestBaseBranchCalled = true;
          return ok('development');
        },
      };

      request.baseBranch = 'feature-branch';

      await createTaskForPR(deps, request);

      expect(getPullRequestBaseBranchCalled).toBe(false);
    });

    it('should fall back to main when API fetch fails', async () => {
      let capturedBaseBranch = '';

      deps.gitHubPRClient = {
        ...createMockGitHubPRClient(),
        async getPullRequestBaseBranch(): ReturnType<GitHubPRClient['getPullRequestBaseBranch']> {
          return err({ code: 'NOT_FOUND', message: 'PR not found' });
        },
      };

      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async create(input): ReturnType<CodeTaskRepository['create']> {
          capturedBaseBranch = (input as unknown as Record<string, string>)['baseBranch'] ?? '';
          return ok({} as never);
        },
      };

      // Use request without baseBranch
      const noBranchRequest: CreateTaskForPRRequest = {
        repository: request.repository,
        prNumber: request.prNumber,
        prTitle: 'Fix the bug',
        senderLogin: request.senderLogin,
        comment: request.comment,
        eventId: request.eventId,
      };

      const result = await createTaskForPR(deps, noBranchRequest);

      expect(result.ok).toBe(true);
      expect(capturedBaseBranch).toBe('main');
    });
  });

  describe('transaction structure (no nesting)', () => {
    it('calls ensureIssueExists before runTransaction', async () => {
      const callOrder: string[] = [];

      deps.linearIssueService = {
        ...createMockLinearIssueService(),
        async ensureIssueExists(): Promise<EnsureIssueResult> {
          callOrder.push('ensureIssueExists');
          return {
            linearIssueId: 'INT-100',
            linearIssueTitle: 'Test Issue',
            linearFallback: false,
            linearIssueLabels: ['code-task'],
            hasChildren: false,
            linearIssueUrl: 'https://linear.app/intexura/issue/INT-100',
          };
        },
      };

      deps.firestore = {
        async runTransaction<T>(fn: (transaction: never) => Promise<T>): Promise<T> {
          callOrder.push('runTransaction');
          const mockTransaction = {
            get: async (): Promise<{ exists: boolean; data: () => null }> => ({ exists: false, data: (): null => null }),
            set: (): void => undefined,
          };
          return fn(mockTransaction as never);
        },
        doc: mockDoc,
      };

      await createTaskForPR(deps, request);

      expect(callOrder.indexOf('ensureIssueExists')).toBeLessThan(callOrder.indexOf('runTransaction'));
    });

    it('passes transaction option to codeTaskRepo.create', async () => {
      let receivedOptions: unknown;

      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async create(_input, options): ReturnType<CodeTaskRepository['create']> {
          receivedOptions = options;
          return ok({} as never);
        },
      };

      await createTaskForPR(deps, request);

      expect(receivedOptions).toBeDefined();
      expect(receivedOptions).toHaveProperty('transaction');
    });

    it('calls runTransaction exactly once (no nesting)', async () => {
      let transactionCallCount = 0;

      deps.firestore = {
        async runTransaction<T>(fn: (transaction: never) => Promise<T>): Promise<T> {
          transactionCallCount++;
          const mockTransaction = {
            get: async (): Promise<{ exists: boolean; data: () => null }> => ({ exists: false, data: (): null => null }),
            set: (): void => undefined,
          };
          return fn(mockTransaction as never);
        },
        doc: mockDoc,
      };

      await createTaskForPR(deps, request);

      expect(transactionCallCount).toBe(1);
    });

    it('returns linear_issue_failed when ensureIssueExists fails before transaction', async () => {
      deps.linearIssueService = {
        ...createMockLinearIssueService(),
        async ensureIssueExists(): Promise<EnsureIssueResult> {
          throw new Error('Linear API timeout');
        },
      };

      let transactionCalled = false;
      deps.firestore = {
        async runTransaction<T>(fn: (transaction: never) => Promise<T>): Promise<T> {
          transactionCalled = true;
          const mockTransaction = {
            get: async (): Promise<{ exists: boolean; data: () => null }> => ({ exists: false, data: (): null => null }),
            set: (): void => undefined,
          };
          return fn(mockTransaction as never);
        },
        doc: mockDoc,
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('linear_issue_failed');
      }
      expect(transactionCalled).toBe(false);
    });
  });

  describe('does not delete PR task lock on enqueue success', () => {
    it('does NOT delete PR task lock on successful enqueue', async () => {
      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      // Verify lock was NOT deleted (task enqueued successfully)
      expect(mockLockDeleteFn).not.toHaveBeenCalled();
    });
  });

  describe('worker type resolution from user settings', () => {
    it('uses defaultPullRequestWorkerType from user settings when no request workerType', async () => {
      let capturedWorkerType: unknown;

      deps.workerSettingsRepo = createFakeWorkerSettingsRepo({
        getSettings: vi.fn().mockResolvedValue(ok({ defaultPullRequestWorkerType: 'sonnet' })),
      });

      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async create(input): ReturnType<CodeTaskRepository['create']> {
          capturedWorkerType = (input as unknown as Record<string, unknown>)['workerType'];
          return ok({} as never);
        },
      };

      await createTaskForPR(deps, request);

      expect(capturedWorkerType).toBe('sonnet');
    });

    it('request workerType takes priority over user default', async () => {
      let capturedWorkerType: unknown;

      deps.workerSettingsRepo = createFakeWorkerSettingsRepo({
        getSettings: vi.fn().mockResolvedValue(ok({ defaultPullRequestWorkerType: 'sonnet' })),
      });

      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async create(input): ReturnType<CodeTaskRepository['create']> {
          capturedWorkerType = (input as unknown as Record<string, unknown>)['workerType'];
          return ok({} as never);
        },
      };

      request.workerType = 'opus';
      await createTaskForPR(deps, request);

      expect(capturedWorkerType).toBe('opus');
    });

    it('falls back to auto when user has no defaultPullRequestWorkerType setting', async () => {
      let capturedWorkerType: unknown;

      deps.workerSettingsRepo = createFakeWorkerSettingsRepo({
        getSettings: vi.fn().mockResolvedValue(ok(null)),
      });

      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async create(input): ReturnType<CodeTaskRepository['create']> {
          capturedWorkerType = (input as unknown as Record<string, unknown>)['workerType'];
          return ok({} as never);
        },
      };

      await createTaskForPR(deps, request);

      expect(capturedWorkerType).toBe('auto');
    });
  });

  it('passes workerType override to created task when provided, taking priority over user default', async () => {
    // User has a defaultPullRequestWorkerType of 'sonnet' in their settings.
    // An explicit workerType in the request ('opus') must always win.
    deps.workerSettingsRepo = createFakeWorkerSettingsRepo({
      getSettings: vi.fn().mockResolvedValue(ok({ defaultPullRequestWorkerType: 'sonnet' })),
    });

    const createSpy = vi.fn().mockResolvedValue(ok({} as never));
    deps.codeTaskRepo = {
      ...createMockCodeTaskRepo(),
      create: createSpy,
    };

    const result = await createTaskForPR(deps, {
      ...request,
      workerType: 'opus',
    });
    expect(result.ok).toBe(true);
    const createCall = (createSpy as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(createCall?.workerType).toBe('opus');
  });
});
