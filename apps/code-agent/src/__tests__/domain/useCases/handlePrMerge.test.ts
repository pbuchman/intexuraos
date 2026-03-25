import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { ok, err } from '@intexuraos/common-core';
import { handlePrMerge, type HandlePrMergeDeps, type HandlePrMergeInput } from '../../../domain/usecases/handlePrMerge.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import type { LinearIssueService } from '../../../domain/services/linearIssueService.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { CodeTask } from '../../../domain/models/codeTask.js';
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

function createDefaultInput(overrides: Partial<HandlePrMergeInput> = {}): HandlePrMergeInput {
  return {
    repository: 'pbuchman/intexuraos',
    prNumber: 42,
    prBody: null,
    prTitle: null,
    prAuthorLogin: null,
    senderLogin: 'pbuchman',
    ...overrides,
  };
}

describe('handlePrMerge', () => {
  let mockLogger: pino.Logger;
  let mockCodeTaskRepo: {
    findByPR: ReturnType<typeof vi.fn>;
    findLatestExecutionTaskByPR: ReturnType<typeof vi.fn>;
  };
  let mockLinearIssueService: {
    markQa: ReturnType<typeof vi.fn>;
  };
  let mockUserServiceClient: {
    resolveGitHubUsername: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockCodeTaskRepo = {
      findByPR: vi.fn().mockResolvedValue(ok(null)),
      findLatestExecutionTaskByPR: vi.fn().mockResolvedValue(ok(null)),
    };
    mockLinearIssueService = {
      markQa: vi.fn().mockResolvedValue(undefined),
    };
    mockUserServiceClient = {
      resolveGitHubUsername: vi.fn().mockResolvedValue(ok({ userId: 'resolved-user' })),
    };
  });

  function buildDeps(): HandlePrMergeDeps {
    return {
      codeTaskRepo: mockCodeTaskRepo as unknown as CodeTaskRepository,
      linearIssueService: mockLinearIssueService as unknown as LinearIssueService,
      userServiceClient: mockUserServiceClient as unknown as UserServiceClient,
      logger: mockLogger,
    };
  }

  it('should transition Linear issue to QA when task found with linearIssueId', async () => {
    mockCodeTaskRepo.findByPR.mockResolvedValue(
      ok(createBaseTask({ linearIssueId: 'INT-100', userId: 'user-from-task' }))
    );

    await handlePrMerge(buildDeps(), createDefaultInput());

    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-from-task', 'INT-100');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
  });

  it('should deduplicate when both repo methods return same task', async () => {
    const task = createBaseTask({ linearIssueId: 'INT-200', userId: 'user-1' });
    mockCodeTaskRepo.findByPR.mockResolvedValue(ok(task));
    mockCodeTaskRepo.findLatestExecutionTaskByPR.mockResolvedValue(ok(task));

    await handlePrMerge(buildDeps(), createDefaultInput());

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

    await handlePrMerge(buildDeps(), createDefaultInput());

    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(2);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-a', 'INT-300');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('user-b', 'INT-400');
  });

  it('should resolve userId and transition when INT-XXX found in PR body', async () => {
    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-500', prAuthorLogin: 'author-login' }),
    );

    expect(mockUserServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('author-login');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-500');
  });

  it('should resolve userId and transition when INT-XXX found in PR title', async () => {
    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prTitle: '[INT-600] fix something' }),
    );

    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-600');
  });

  it('should deduplicate when same INT-XXX found in body and title', async () => {
    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-700', prTitle: '[INT-700] fix' }),
    );

    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-700');
  });

  it('should transition both when task has different issue than PR body', async () => {
    mockCodeTaskRepo.findByPR.mockResolvedValue(
      ok(createBaseTask({ linearIssueId: 'INT-800', userId: 'task-user' }))
    );

    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-900', prAuthorLogin: 'author' }),
    );

    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(2);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('task-user', 'INT-800');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-900');
  });

  it('should not call markQa when no task and no INT-XXX found', async () => {
    await handlePrMerge(buildDeps(), createDefaultInput());

    expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
    expect(vi.mocked(mockLogger.debug)).toHaveBeenCalledWith(
      expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
      'No Linear issues found for merged PR'
    );
  });

  it('should skip issue when userId resolution fails', async () => {
    mockUserServiceClient.resolveGitHubUsername.mockResolvedValue(
      err({ code: 'API_ERROR', message: 'HTTP 500' })
    );

    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-1000', prAuthorLogin: 'author' }),
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

    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-1100', prAuthorLogin: 'author' }),
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

    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-1500', prAuthorLogin: 'author' }),
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

    await handlePrMerge(buildDeps(), createDefaultInput());

    expect(mockLinearIssueService.markQa).not.toHaveBeenCalled();
  });

  it('should fall back to senderLogin when prAuthorLogin is null', async () => {
    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-1200', prAuthorLogin: null, senderLogin: 'merger-login' }),
    );

    expect(mockUserServiceClient.resolveGitHubUsername).toHaveBeenCalledWith('merger-login');
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('resolved-user', 'INT-1200');
  });

  it('should skip issue when resolveGitHubUsername returns ok(null)', async () => {
    mockUserServiceClient.resolveGitHubUsername.mockResolvedValue(ok(null));

    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-1300', prAuthorLogin: 'unknown' }),
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

    await handlePrMerge(
      buildDeps(),
      createDefaultInput({ prBody: 'Fixes INT-1400', prAuthorLogin: 'author' }),
    );

    expect(mockUserServiceClient.resolveGitHubUsername).not.toHaveBeenCalled();
    expect(mockLinearIssueService.markQa).toHaveBeenCalledTimes(1);
    expect(mockLinearIssueService.markQa).toHaveBeenCalledWith('task-user', 'INT-1400');
  });
});
