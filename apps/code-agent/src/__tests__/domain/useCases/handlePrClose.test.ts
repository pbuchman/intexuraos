import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { ok, err } from '@intexuraos/common-core';
import { handlePrClose, type HandlePrCloseDeps, type HandlePrCloseInput } from '../../../domain/usecases/handlePrClose.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { LinearIssueService } from '../../../domain/services/linearIssueService.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { TaskDispatcherService } from '../../../domain/services/taskDispatcher.js';
import type { WorkerSettingsRepository } from '../../../domain/ports/workerSettingsRepository.js';
import { createMockLogger } from '../../helpers/mockLogger.js';

function createBaseTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task_abc',
    userId: 'user-from-task',
    prompt: 'test',
    sanitizedPrompt: 'test',
    systemPromptHash: 'hash',
    workerType: 'auto',
    workerLocation: 'queued',
    status: 'completed',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    createdAt: new Date(),
    updatedAt: new Date(),
    traceId: 'trace',
    actionId: 'action',
    approvalEventId: 'event',
    dedupKey: 'dedup',
    ...overrides,
  } as CodeTask;
}

function createInput(overrides: Partial<HandlePrCloseInput> = {}): HandlePrCloseInput {
  return {
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    prBody: null,
    prTitle: null,
    prAuthorLogin: null,
    senderLogin: 'pbuchman',
    isMerged: false,
    ...overrides,
  };
}

function createMergedInput(overrides: Partial<HandlePrCloseInput> = {}): HandlePrCloseInput {
  return createInput({ isMerged: true, ...overrides });
}

function createClosedInput(overrides: Partial<HandlePrCloseInput> = {}): HandlePrCloseInput {
  return createInput(overrides);
}

describe('handlePrClose (merged and closed-without-merge)', () => {
  let mockLogger: pino.Logger;
  let mockCodeTaskRepo: {
    findByPR: ReturnType<typeof vi.fn>;
    findLatestExecutionTaskByPR: ReturnType<typeof vi.fn>;
    findOriginTaskByPR: ReturnType<typeof vi.fn>;
    findPreservedPullRequestTask: ReturnType<typeof vi.fn>;
  };
  let mockLinearIssueService: {
    markQa: ReturnType<typeof vi.fn>;
    markTodo: ReturnType<typeof vi.fn>;
    removeLabel: ReturnType<typeof vi.fn>;
  };
  let mockUserServiceClient: {
    resolveGitHubUsername: ReturnType<typeof vi.fn>;
  };
  let mockTaskDispatcher: {
    cancelOnWorker: ReturnType<typeof vi.fn>;
  };
  let mockWorkerSettingsRepo: {
    getSettings: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockCodeTaskRepo = {
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findOriginTaskByPR: vi.fn().mockResolvedValue(ok(null)),
      findPreservedPullRequestTask: vi.fn().mockResolvedValue(ok(null)),
    };
    mockLinearIssueService = {
      markQa: vi.fn().mockResolvedValue(undefined),
      markTodo: vi.fn().mockResolvedValue(undefined),
      removeLabel: vi.fn().mockResolvedValue(undefined),
    };
    mockUserServiceClient = {
      resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'resolved-user' })),
    };
    mockTaskDispatcher = {
      cancelOnWorker: vi.fn().mockResolvedValue(undefined),
    };
    mockWorkerSettingsRepo = {
      getSettings: vi.fn().mockResolvedValue(ok(null)),
    };
  });

  function buildDeps(): HandlePrCloseDeps {
    return {
      codeTaskRepo: mockCodeTaskRepo as unknown as CodeTaskRepository,
      linearIssueService: mockLinearIssueService as unknown as LinearIssueService,
      userServiceClient: mockUserServiceClient as unknown as UserServiceClient,
      taskDispatcher: mockTaskDispatcher as unknown as TaskDispatcherService,
      workerSettingsRepo: mockWorkerSettingsRepo as unknown as WorkerSettingsRepository,
      logger: mockLogger,
    };
  }

  it('should transition Linear issue to QA when task found with linearIssueId', async () => {
    mockCodeTaskRepo.findByPR.mockResolvedValue(
      ok(createBaseTask({ linearIssueId: 'INT-100', userId: 'user-from-task' }))
    );

    await handlePrClose(buildDeps(), createMergedInput());

    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-from-task', 'INT-100');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate when both repo methods return same task', async () => {
    const task = createBaseTask({ linearIssueId: 'INT-200', userId: 'user-1' });
    mockCodeTaskRepo.findByPR.mockResolvedValue(ok(task));
    mockCodeTaskRepo.findLatestExecutionTaskByPR.mockResolvedValue(ok(task));

    await handlePrClose(buildDeps(), createMergedInput());

    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-1', 'INT-200');
  });

  it('should transition both issues when repo methods return different tasks', async () => {
    mockCodeTaskRepo.findByPR.mockResolvedValue(
      ok(createBaseTask({ linearIssueId: 'INT-300', userId: 'user-a' }))
    );
    mockCodeTaskRepo.findLatestExecutionTaskByPR.mockResolvedValue(
      ok(createBaseTask({ id: 'task_def', linearIssueId: 'INT-400', userId: 'user-b' }))
    );

    await handlePrClose(buildDeps(), createMergedInput());

    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(2);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-a', 'INT-300');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-b', 'INT-400');
  });

  it('should resolve userId and transition when INT-XXX found in PR body', async () => {
    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-500', prAuthorLogin: 'author-login' }),
    );

    expect(mockUserServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('author-login');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-500');
  });

  it('should resolve userId and transition when INT-XXX found in PR title', async () => {
    await handlePrClose(
      buildDeps(),
      createMergedInput({ prTitle: '[INT-600] fix something' }),
    );

    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-600');
  });

  it('should deduplicate when same INT-XXX found in body and title', async () => {
    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-700', prTitle: '[INT-700] fix' }),
    );

    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-700');
  });

  it('should transition both when task has different issue than PR body', async () => {
    mockCodeTaskRepo.findByPR.mockResolvedValue(
      ok(createBaseTask({ linearIssueId: 'INT-800', userId: 'task-user' }))
    );

    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-900', prAuthorLogin: 'author' }),
    );

    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(2);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('task-user', 'INT-800');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-900');
  });

  it('should not call markQa when no task and no INT-XXX found', async () => {
    await handlePrClose(buildDeps(), createMergedInput());

    expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    expect(vi.mocked(mockLogger.debug)).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42, isMerged: true }),
      'No Linear issues found for closed PR'
    );
  });

  it('should skip issue when userId resolution fails', async () => {
    mockUserServiceClient.resolveGitHubUsername.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'HTTP 500' })
    );

    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-1000', prAuthorLogin: 'author' }),
    );

    expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    expect(vi.mocked(mockLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-1000' }),
      expect.stringContaining('resolve')
    );
  });

  it('should continue with other discovery when findByPR returns err', async () => {
    mockCodeTaskRepo.findByPR.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'connection failed' })
    );

    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-1100', prAuthorLogin: 'author' }),
    );

    expect(vi.mocked(mockLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }) }),
      expect.stringContaining('findByPR')
    );
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-1100');
  });

  it('should continue with other discovery when findLatestExecutionTaskByPR returns err', async () => {
    mockCodeTaskRepo.findLatestExecutionTaskByPR.mockResolvedValue(
      err({ code: 'FIRESTORE_ERROR', message: 'timeout' })
    );

    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-1500', prAuthorLogin: 'author' }),
    );

    expect(vi.mocked(mockLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'FIRESTORE_ERROR' }) }),
      expect.stringContaining('findLatestExecutionTaskByPR')
    );
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-1500');
  });

  it('should skip task with no linearIssueId', async () => {
    const taskWithoutIssue = createBaseTask();
    delete (taskWithoutIssue as unknown as Record<string, unknown>)['linearIssueId'];
    mockCodeTaskRepo.findByPR.mockResolvedValue(ok(taskWithoutIssue));

    await handlePrClose(buildDeps(), createMergedInput());

    expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
  });

  it('should fall back to senderLogin when prAuthorLogin is null', async () => {
    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-1200', prAuthorLogin: null, senderLogin: 'merger-login' }),
    );

    expect(mockUserServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('merger-login');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-1200');
  });

  it('should skip issue when resolveGitHubUsername returns ok(null)', async () => {
    mockUserServiceClient.resolveGitHubUsername.mockResolvedValue(ok(null));

    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-1300', prAuthorLogin: 'unknown' }),
    );

    expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    expect(vi.mocked(mockLogger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ linearIssueId: 'INT-1300' }),
      expect.stringContaining('resolve')
    );
  });

  it('should not resolve userId for body/title issues already found via task', async () => {
    mockCodeTaskRepo.findByPR.mockResolvedValue(
      ok(createBaseTask({ linearIssueId: 'INT-1400', userId: 'task-user' }))
    );

    await handlePrClose(
      buildDeps(),
      createMergedInput({ prBody: 'Fixes INT-1400', prAuthorLogin: 'author' }),
    );

    expect(mockUserServiceClient.resolveGitHubUsername).not.toHaveBeenCalled();
    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('task-user', 'INT-1400');
  });

  describe('preserved container cleanup on PR merge', () => {
    it('destroys preserved pull_request container on PR merge', async () => {
      mockCodeTaskRepo.findPreservedPullRequestTask.mockResolvedValue(
        ok({ id: 'task_preserved', workerLocation: 'worker-home', userId: 'user-preserved' })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'worker-home',
              url: 'https://worker.example.com',
              cfAccessClientId: 'client-id',
              cfAccessClientSecret: 'client-secret',
              enabled: true,
            },
          ],
        })
      );

      await handlePrClose(buildDeps(), createMergedInput());

      expect(mockCodeTaskRepo.findPreservedPullRequestTask).toHaveBeenCalledWith('pbuchman/intexuraos', 42);
      expect(mockWorkerSettingsRepo.getSettings).toHaveBeenCalledWith('user-preserved');
      expect(mockTaskDispatcher.cancelOnWorker).toHaveBeenCalledWith(
        'task_preserved',
        'worker-home',
        { url: 'https://worker.example.com', cfAccessClientId: 'client-id', cfAccessClientSecret: 'client-secret' },
      );
    });

    it('does not fail if no preserved container exists', async () => {
      mockCodeTaskRepo.findPreservedPullRequestTask.mockResolvedValue(ok(null));

      await expect(handlePrClose(buildDeps(), createMergedInput())).resolves.toBeUndefined();
      expect(mockTaskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
    });

    it('does not fail if findPreservedPullRequestTask returns err', async () => {
      mockCodeTaskRepo.findPreservedPullRequestTask.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'connection failed' })
      );

      await expect(handlePrClose(buildDeps(), createMergedInput())).resolves.toBeUndefined();
      expect(mockTaskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
    });

    it('does not fail if cancelOnWorker throws', async () => {
      mockCodeTaskRepo.findPreservedPullRequestTask.mockResolvedValue(
        ok({ id: 'task_preserved', workerLocation: 'worker-home', userId: 'user-preserved' })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(ok(null));
      mockTaskDispatcher.cancelOnWorker.mockRejectedValue(new Error('network error'));

      await expect(handlePrClose(buildDeps(), createMergedInput())).resolves.toBeUndefined();
    });

    it('calls cancelOnWorker with undefined credentials when worker config not found', async () => {
      mockCodeTaskRepo.findPreservedPullRequestTask.mockResolvedValue(
        ok({ id: 'task_preserved', workerLocation: 'unknown-worker', userId: 'user-preserved' })
      );
      mockWorkerSettingsRepo.getSettings.mockResolvedValue(
        ok({
          workers: [
            {
              name: 'other-worker',
              url: 'https://other.example.com',
              cfAccessClientId: 'other-id',
              cfAccessClientSecret: 'other-secret',
              enabled: true,
            },
          ],
        })
      );

      await handlePrClose(buildDeps(), createMergedInput());

      expect(mockTaskDispatcher.cancelOnWorker).toHaveBeenCalledWith(
        'task_preserved',
        'unknown-worker',
        undefined,
      );
    });
  });

  describe('ready-to-merge label removal', () => {
    it('should remove ready-to-merge label from all discovered issues after transition', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-100', userId: 'user-from-task' }))
      );

      await handlePrClose(buildDeps(), createMergedInput());

      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledWith('user-from-task', 'INT-100', 'ready-to-merge');
      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledTimes(1);
    });

    it('should remove ready-to-merge label from multiple issues', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-800', userId: 'task-user' }))
      );

      await handlePrClose(
        buildDeps(),
        createMergedInput({ prBody: 'Fixes INT-900', prAuthorLogin: 'author' }),
      );

      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledWith('task-user', 'INT-800', 'ready-to-merge');
      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledWith('resolved-user', 'INT-900', 'ready-to-merge');
      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledTimes(2);
    });

    it('should not call removeLabel when no issues found', async () => {
      await handlePrClose(buildDeps(), createMergedInput());

      expect(mockLinearIssueService.removeLabel).not.toHaveBeenCalled();
    });

    it('should still remove label on plan PRs', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-100', userId: 'user-from-task' }))
      );

      await handlePrClose(
        buildDeps(),
        createMergedInput({ prTitle: '[INT-100] [plan] Add feature' }),
      );

      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledWith('user-from-task', 'INT-100', 'ready-to-merge');
    });

  });

  describe('close without merge (label cleanup only)', () => {
    it('should remove ready-to-merge label but NOT transition state when PR closed without merge', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-100', userId: 'user-from-task' }))
      );

      await handlePrClose(buildDeps(), createClosedInput());

      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledWith('user-from-task', 'INT-100', 'ready-to-merge');
      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledTimes(1);
      expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
      expect(mockLinearIssueService.markTodo).not.toHaveBeenCalled();
    });

    it('should remove label from issues discovered via title extraction', async () => {
      await handlePrClose(
        buildDeps(),
        createClosedInput({ prTitle: '[INT-500] fix something', prAuthorLogin: 'author' }),
      );

      expect(mockLinearIssueService.removeLabel).toHaveBeenCalledWith('resolved-user', 'INT-500', 'ready-to-merge');
      expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    });

    it('should not call removeLabel when no issues found on close', async () => {
      await handlePrClose(buildDeps(), createClosedInput());

      expect(mockLinearIssueService.removeLabel).not.toHaveBeenCalled();
      expect(vi.mocked(mockLogger.debug)).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42, isMerged: false }),
        'No Linear issues found for closed PR'
      );
    });

    it('should not destroy preserved container when PR closed without merge', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-100', userId: 'user-from-task' }))
      );
      mockCodeTaskRepo.findPreservedPullRequestTask.mockResolvedValue(
        ok({ id: 'task_preserved', workerLocation: 'worker-home', userId: 'user-preserved' })
      );

      await handlePrClose(buildDeps(), createClosedInput());

      expect(mockCodeTaskRepo.findPreservedPullRequestTask).not.toHaveBeenCalled();
      expect(mockTaskDispatcher.cancelOnWorker).not.toHaveBeenCalled();
    });
  });

  describe('plan PR detection', () => {
    it('should transition to Todo (not QA) when PR title contains [plan]', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-100', userId: 'user-from-task' }))
      );

      await handlePrClose(
        buildDeps(),
        createMergedInput({ prTitle: '[INT-100] [plan] Add remediation agent' }),
      );

      expect(mockLinearIssueService.markTodo).toHaveBeenCalledWith('user-from-task', 'INT-100');
      expect(mockLinearIssueService.markTodo).toHaveBeenCalledTimes(1);
      expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    });

    it('should transition to QA when PR title has no [plan] prefix', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-200', userId: 'user-from-task' }))
      );

      await handlePrClose(
        buildDeps(),
        createMergedInput({ prTitle: '[INT-200] Fix auth bug' }),
      );

      expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-from-task', 'INT-200');
      expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
      expect(mockLinearIssueService.markTodo).not.toHaveBeenCalled();
    });

    it('should detect [PLAN] case-insensitively (uppercase)', async () => {
      mockCodeTaskRepo.findByPR.mockResolvedValue(
        ok(createBaseTask({ linearIssueId: 'INT-150', userId: 'user-from-task' }))
      );

      await handlePrClose(
        buildDeps(),
        createMergedInput({ prTitle: '[INT-150] [PLAN] Uppercase plan tag' }),
      );

      expect(mockLinearIssueService.markTodo).toHaveBeenCalledWith('user-from-task', 'INT-150');
      expect(mockLinearIssueService.markTodo).toHaveBeenCalledTimes(1);
      expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    });

    it('should transition to Todo when plan PR has INT-XXX in body (not task)', async () => {
      await handlePrClose(
        buildDeps(),
        createMergedInput({
          prTitle: '[INT-300] [plan] New feature',
          prBody: 'Fixes INT-300',
          prAuthorLogin: 'author-login',
        }),
      );

      expect(mockLinearIssueService.markTodo).toHaveBeenCalledWith('resolved-user', 'INT-300');
      expect(mockLinearIssueService.markTodo).toHaveBeenCalledTimes(1);
      expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    });
  });
});
