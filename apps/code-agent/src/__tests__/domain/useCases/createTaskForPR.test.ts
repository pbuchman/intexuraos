/**
 * Tests for createTaskForPR use case.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import type { Logger } from '@intexuraos/common-core';
import pino from 'pino';
import { createTaskForPR, type CreateTaskForPRDeps, type CreateTaskForPRRequest } from '../../../domain/usecases/createTaskForPR.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { UserLookupService } from '../../../domain/ports/userLookupService.js';
import type { LinearIssueService, EnsureIssueResult } from '../../../domain/services/linearIssueService.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { WhatsAppNotifier } from '../../../domain/services/whatsappNotifier.js';
import type { DispatchRetryRepository } from '../../../domain/repositories/dispatchRetryRepository.js';

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
    async deleteTask(): ReturnType<CodeTaskRepository['deleteTask']> {
      return ok(undefined);
    },
    async findOldestQueued(): ReturnType<CodeTaskRepository['findOldestQueued']> {
      return ok(null);
    },
    async countQueued(): ReturnType<CodeTaskRepository['countQueued']> {
      return ok(0);
    },
    async findPlannedTaskByLinearIssue(): ReturnType<CodeTaskRepository['findPlannedTaskByLinearIssue']> {
      return ok(null);
    },
  };
}

function createMockTaskDispatcher(): TaskDispatcherService {
  return {
    async dispatch(): ReturnType<TaskDispatcherService['dispatch']> {
      return ok({ dispatched: true, workerLocation: 'home-mac' });
    },
    async cancelOnWorker(): Promise<void> { return; },
    async sendMessageToWorker(): ReturnType<TaskDispatcherService['sendMessageToWorker']> {
      return ok({ action: 'queued' });
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
        authorLogin: 'alice',
        baseBranch: 'main',
        headBranch: 'feature/test',
        mergeable: true,
        mergeableState: 'clean',
      });
    },
    async updateIssueComment(): ReturnType<GitHubPRClient['updateIssueComment']> {
      return ok({ commentId: 1 });
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

function createMockDispatchRetryRepo(): DispatchRetryRepository {
  return {
    async create(): ReturnType<DispatchRetryRepository['create']> {
      return ok({} as never);
    },
    async findOldest(): ReturnType<DispatchRetryRepository['findOldest']> {
      return ok(null);
    },
    async delete(): ReturnType<DispatchRetryRepository['delete']> {
      return ok(undefined);
    },
    async update(): ReturnType<DispatchRetryRepository['update']> {
      return ok(undefined);
    },
  };
}

function createDefaultDeps(): CreateTaskForPRDeps {
  return {
    logger,
    codeTaskRepo: createMockCodeTaskRepo(),
    userLookupService: createMockUserLookupService(),
    linearIssueService: createMockLinearIssueService(),
    taskDispatcher: createMockTaskDispatcher(),
    whatsappNotifier: createMockWhatsAppNotifier(),
    orchestratorSecret: 'test-secret',
    serviceUrl: 'https://code-agent.test',
    gitHubPRClient: createMockGitHubPRClient(),
    userServiceClient: createMockUserServiceClient(),
    firestore: createMockFirestore(),
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

  it('creates a task and dispatches it successfully', async () => {
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

  it('returns task_creation_failed when dispatch fails', async () => {
    deps.taskDispatcher = {
      ...createMockTaskDispatcher(),
      async dispatch(): ReturnType<TaskDispatcherService['dispatch']> {
        return err({ code: 'worker_unavailable', message: 'No workers available' });
      },
    };

    const result = await createTaskForPR(deps, request);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('task_creation_failed');
      expect(result.error.message).toContain('dispatch failed');
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

  it('preserves pr-comment label when already present in existing issue labels', async () => {
    let capturedLabels: string[] = [];

    // Simulate existing Linear issue (INT-XXX in title) with pr-comment already in labels
    request.prTitle = '[INT-200] Already linked PR';

    deps.linearIssueService = {
      ...createMockLinearIssueService(),
      async ensureIssueExists(): Promise<EnsureIssueResult> {
        return {
          linearIssueId: 'INT-200',
          linearIssueTitle: 'Existing Issue',
          linearFallback: false,
          linearIssueLabels: ['code-task', 'pr-comment'],
          hasChildren: false,
          linearIssueUrl: 'https://linear.app/intexura/issue/INT-200',
        };
      },
    };

    deps.taskDispatcher = {
      ...createMockTaskDispatcher(),
      async dispatch(req): ReturnType<TaskDispatcherService['dispatch']> {
        capturedLabels = req.linearIssueLabels;
        return ok({ dispatched: true, workerLocation: 'home-mac' });
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedLabels).toContain('pr-comment');
    expect(capturedLabels).toContain('code-task');
    // Should not have duplicate pr-comment
    expect(capturedLabels.filter(l => l === 'pr-comment')).toHaveLength(1);
  });

  it('includes pr-comment label in dispatch', async () => {
    let capturedLabels: string[] = [];

    deps.taskDispatcher = {
      ...createMockTaskDispatcher(),
      async dispatch(req): ReturnType<TaskDispatcherService['dispatch']> {
        capturedLabels = req.linearIssueLabels;
        return ok({ dispatched: true, workerLocation: 'home-mac' });
      },
    };

    await createTaskForPR(deps, request);

    expect(capturedLabels).toContain('pr-comment');
    expect(capturedLabels).toContain('code-task');
  });

  describe('queueing fallback (at_capacity)', () => {
    beforeEach(() => {
      deps.taskDispatcher = {
        ...createMockTaskDispatcher(),
        async dispatch(): ReturnType<TaskDispatcherService['dispatch']> {
          return err({ code: 'at_capacity', message: 'All workers are busy' });
        },
      };
    });

    it('queues task when at_capacity and queue has room', async () => {
      const updateCalls: Record<string, unknown>[] = [];
      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async update(_id: string, data: Record<string, unknown>): ReturnType<CodeTaskRepository['update']> {
          updateCalls.push(data);
          return ok({} as never);
        },
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.taskId).toMatch(/^task_/);
      }
      // Task already starts as 'queued' — no status update call in the at_capacity path
      const statusUpdates = updateCalls.filter(d => typeof d['status'] === 'string');
      expect(statusUpdates).toHaveLength(0);
    });

    it('returns queue_full when at_capacity and queue is full', async () => {
      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async countQueued(): ReturnType<CodeTaskRepository['countQueued']> {
          return ok(11);
        },
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
    });

    it('returns queue_full when countQueued fails (fail-closed)', async () => {
      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async countQueued(): ReturnType<CodeTaskRepository['countQueued']> {
          return err({ code: 'FIRESTORE_ERROR', message: 'Firestore error' });
        },
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
    });

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

    it('should dispatch with the same resolved baseBranch as the task record', async () => {
      let dispatchedBaseBranch = '';

      deps.gitHubPRClient = {
        ...createMockGitHubPRClient(),
        async getPullRequestBaseBranch(): ReturnType<GitHubPRClient['getPullRequestBaseBranch']> {
          return ok('development');
        },
      };

      deps.taskDispatcher = {
        ...createMockTaskDispatcher(),
        async dispatch(req): ReturnType<TaskDispatcherService['dispatch']> {
          dispatchedBaseBranch = (req as unknown as Record<string, string>)['baseBranch'] ?? '';
          return ok({ dispatched: true, workerLocation: 'home-mac' });
        },
      };

      const noBranchRequest: CreateTaskForPRRequest = {
        repository: request.repository,
        prNumber: request.prNumber,
        prTitle: 'Fix the bug',
        senderLogin: request.senderLogin,
        comment: request.comment,
        eventId: request.eventId,
      };

      await createTaskForPR(deps, noBranchRequest);

      expect(dispatchedBaseBranch).toBe('development');
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

  describe('PR task lock cleanup', () => {
    it('deletes PR task lock on dispatch failure (non-capacity)', async () => {
      deps.taskDispatcher = {
        ...createMockTaskDispatcher(),
        async dispatch(): ReturnType<TaskDispatcherService['dispatch']> {
          return err({ code: 'worker_unavailable', message: 'No workers available' });
        },
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('task_creation_failed');
      }
      // Verify lock was deleted
      expect(mockLockDeleteFn).toHaveBeenCalled();
    });

    it('deletes PR task lock on queue full', async () => {
      deps.taskDispatcher = {
        ...createMockTaskDispatcher(),
        async dispatch(): ReturnType<TaskDispatcherService['dispatch']> {
          return err({ code: 'at_capacity', message: 'All workers are busy' });
        },
      };
      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async countQueued(): ReturnType<CodeTaskRepository['countQueued']> {
          return ok(11);
        },
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('queue_full');
      }
      // Verify lock was deleted
      expect(mockLockDeleteFn).toHaveBeenCalled();
    });

    it('does NOT delete PR task lock on successful dispatch', async () => {
      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      // Verify lock was NOT deleted (task dispatched successfully)
      expect(mockLockDeleteFn).not.toHaveBeenCalled();
    });

    it('does NOT delete PR task lock when task is queued (capacity but not full)', async () => {
      deps.taskDispatcher = {
        ...createMockTaskDispatcher(),
        async dispatch(): ReturnType<TaskDispatcherService['dispatch']> {
          return err({ code: 'at_capacity', message: 'All workers are busy' });
        },
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      // Verify lock was NOT deleted (task queued, not failed)
      expect(mockLockDeleteFn).not.toHaveBeenCalled();
    });
  });

  describe('dispatch retry queue (retryable errors)', () => {
    beforeEach(() => {
      deps.taskDispatcher = {
        ...createMockTaskDispatcher(),
        async dispatch(): ReturnType<TaskDispatcherService['dispatch']> {
          return err({ code: 'worker_unavailable', message: 'Worker timed out' });
        },
      };
      deps.dispatchRetryRepo = createMockDispatchRetryRepo();
    });

    it('queues for retry when dispatch fails with retryable error and dispatchRetryRepo is available', async () => {
      let retryCaptured: Record<string, unknown> | undefined;
      deps.dispatchRetryRepo = {
        ...createMockDispatchRetryRepo(),
        async create(input): ReturnType<DispatchRetryRepository['create']> {
          retryCaptured = input as unknown as Record<string, unknown>;
          return ok({} as never);
        },
      };

      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.taskId).toMatch(/^task_/);
      }
      expect(retryCaptured).toBeDefined();
      expect(retryCaptured?.['type']).toBe('new_task');
      expect(retryCaptured?.['repository']).toBe('pbuchman/intexuraos');
      expect(retryCaptured?.['lastError']).toBe('Worker timed out');
    });

    it('includes prTitle in retry entry when present in request', async () => {
      let retryCaptured: Record<string, unknown> | undefined;
      deps.dispatchRetryRepo = {
        ...createMockDispatchRetryRepo(),
        async create(input): ReturnType<DispatchRetryRepository['create']> {
          retryCaptured = input as unknown as Record<string, unknown>;
          return ok({} as never);
        },
      };

      request.prTitle = 'My PR Title';
      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      expect(retryCaptured?.['prTitle']).toBe('My PR Title');
    });

    it('omits prTitle from retry entry when not present in request', async () => {
      let retryCaptured: Record<string, unknown> | undefined;
      deps.dispatchRetryRepo = {
        ...createMockDispatchRetryRepo(),
        async create(input): ReturnType<DispatchRetryRepository['create']> {
          retryCaptured = input as unknown as Record<string, unknown>;
          return ok({} as never);
        },
      };

      delete (request as unknown as Record<string, unknown>)['prTitle'];
      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      expect(retryCaptured).not.toHaveProperty('prTitle');
    });

    it('includes baseBranch in retry entry when resolved', async () => {
      let retryCaptured: Record<string, unknown> | undefined;
      deps.dispatchRetryRepo = {
        ...createMockDispatchRetryRepo(),
        async create(input): ReturnType<DispatchRetryRepository['create']> {
          retryCaptured = input as unknown as Record<string, unknown>;
          return ok({} as never);
        },
      };

      request.baseBranch = 'development';
      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      expect(retryCaptured?.['baseBranch']).toBe('development');
    });

    it('does NOT delete PR task lock when queued for retry', async () => {
      const result = await createTaskForPR(deps, request);

      expect(result.ok).toBe(true);
      expect(mockLockDeleteFn).not.toHaveBeenCalled();
    });

    it('updates task status to queued with queuedAt when queuing for retry', async () => {
      const updateCalls: { id: string; data: Record<string, unknown> }[] = [];
      deps.codeTaskRepo = {
        ...createMockCodeTaskRepo(),
        async update(id: string, data: Record<string, unknown>): ReturnType<CodeTaskRepository['update']> {
          updateCalls.push({ id, data });
          return ok({} as never);
        },
      };

      await createTaskForPR(deps, request);

      const statusUpdate = updateCalls.find(c => c.data['status'] === 'queued');
      expect(statusUpdate).toBeDefined();
      expect(statusUpdate?.data['queuedAt']).toBeInstanceOf(Date);
    });
  });
});
