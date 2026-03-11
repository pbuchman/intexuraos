import { Timestamp } from '@google-cloud/firestore';
import { err, ok, type Logger } from '@intexuraos/common-core';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { GitHubPRClient } from '../../../domain/ports/gitHubPRClient.js';
import type { CodeTaskRepository } from '../../../domain/repositories/codeTaskRepository.js';
import {
  postContinuationPrComment,
  resolveContinuationPr,
  type PostContinuationCommentDeps,
  type ResolveContinuationPrDeps,
} from '../../../domain/utils/continuationPr.js';

describe('continuationPr utilities', () => {
  let mockLogger: Logger;
  let mockCodeTaskRepo: {
    findById: ReturnType<typeof vi.fn>;
    findRecentTasksByLinearIssue: ReturnType<typeof vi.fn>;
  };
  let mockGitHubPRClient: {
    updatePRTitle: ReturnType<typeof vi.fn>;
    getPullRequestFiles: ReturnType<typeof vi.fn>;
    getPullRequestCommits: ReturnType<typeof vi.fn>;
    getPullRequestBaseBranch: ReturnType<typeof vi.fn>;
    getPullRequestStatus: ReturnType<typeof vi.fn>;
    postPRComment: ReturnType<typeof vi.fn>;
  };
  let mockUserServiceClient: {
    getOAuthToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;

    mockCodeTaskRepo = {
      findById: vi.fn(),
      findRecentTasksByLinearIssue: vi.fn().mockResolvedValue(ok([])),
    };

    mockGitHubPRClient = {
      updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
      getPullRequestFiles: vi.fn().mockResolvedValue(ok([])),
      getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
      getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('development')),
      getPullRequestStatus: vi.fn(),
      postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 42 })),
    };

    mockUserServiceClient = {
      getOAuthToken: vi.fn().mockResolvedValue(ok({ accessToken: 'gh-token' })),
    };
  });

  function createTask(overrides: Partial<CodeTask> = {}): CodeTask {
    const now = Timestamp.now();
    const task: CodeTask = {
      id: 'task_current',
      userId: 'user-123',
      traceId: 'trace-123',
      prompt: 'Retry the code task',
      sanitizedPrompt: 'Retry the code task',
      systemPromptHash: 'hash-123',
      workerType: 'auto',
      workerLocation: 'home-mac',
      status: 'failed',
      repository: 'pbuchman/intexuraos',
      baseBranch: 'development',
      dedupKey: 'dedup-123',
      callbackReceived: false,
      createdAt: now,
      updatedAt: now,
      linearIssueId: 'INT-824',
      ...overrides,
    };

    return task;
  }

  function createResolveDeps(): ResolveContinuationPrDeps {
    return {
      logger: mockLogger,
      codeTaskRepo: mockCodeTaskRepo as unknown as CodeTaskRepository,
      gitHubPRClient: mockGitHubPRClient as unknown as GitHubPRClient,
      userServiceClient: mockUserServiceClient as unknown as UserServiceClient,
    };
  }

  function createCommentDeps(): PostContinuationCommentDeps {
    return {
      logger: mockLogger,
      gitHubPRClient: mockGitHubPRClient as unknown as GitHubPRClient,
      userServiceClient: mockUserServiceClient as unknown as UserServiceClient,
    };
  }

  describe('resolveContinuationPr', () => {
    it('returns an open lineage continuation PR using the live head branch', async () => {
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_existing_pr_branch',
        })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask({ prNumber: 1131, prBranch: 'task_stale_branch' }),
        userId: 'user-123',
      });

      expect(result).toEqual(
        ok({
          prNumber: 1131,
          prBranch: 'task_existing_pr_branch',
        })
      );
      expect(mockCodeTaskRepo.findRecentTasksByLinearIssue).not.toHaveBeenCalled();
    });

    it('parses a continuation PR number from legacy result.prUrl metadata', async () => {
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_legacy_branch',
        })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask({
          result: { prUrl: 'https://github.com/pbuchman/intexuraos/pull/1144' },
        }),
        userId: 'user-123',
      });

      expect(result).toEqual(
        ok({
          prNumber: 1144,
          prBranch: 'task_legacy_branch',
        })
      );
    });

    it('returns null when result.prUrl does not contain a pull request number', async () => {
      const task = createTask({
        result: { prUrl: 'https://github.com/pbuchman/intexuraos/issues/1144' },
      });
      delete (task as unknown as { linearIssueId?: string }).linearIssueId;

      const result = await resolveContinuationPr(createResolveDeps(), {
        task,
        userId: 'user-123',
      });

      expect(result).toEqual(ok(null));
      expect(mockGitHubPRClient.getPullRequestStatus).not.toHaveBeenCalled();
    });

    it('returns verification_failed when a candidate repository is invalid', async () => {
      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask({
          repository: 'pbuchman-only',
          prNumber: 1131,
        }),
        userId: 'user-123',
      });

      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.error.code).toBe('verification_failed');
      expect(result.error.message).toContain('Invalid repository format');
    });

    it('logs and skips missing PR candidates before reusing the newest same-ticket open PR', async () => {
      mockCodeTaskRepo.findRecentTasksByLinearIssue.mockResolvedValue(
        ok([
          createTask({
            id: 'task_same_ticket',
            prNumber: 1139,
            prBranch: 'task_old_same_ticket_branch',
          }),
        ])
      );
      mockGitHubPRClient.getPullRequestStatus
        .mockResolvedValueOnce(err({ code: 'NOT_FOUND', message: 'PR missing' }))
        .mockResolvedValueOnce(
          ok({
            state: 'open',
            mergedAt: null,
            headRef: 'task_same_ticket_open_pr_branch',
          })
        );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask({ prNumber: 1131 }),
        userId: 'user-123',
      });

      expect(result).toEqual(
        ok({
          prNumber: 1139,
          prBranch: 'task_same_ticket_open_pr_branch',
        })
      );
      expect(mockUserServiceClient.getOAuthToken).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: 'task_current', prNumber: 1131 }),
        'Continuation PR candidate no longer exists'
      );
    });

    it('returns verification_failed when GitHub PR verification fails', async () => {
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        err({ code: 'API_ERROR', message: 'GitHub API unavailable' })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask({ prNumber: 1131 }),
        userId: 'user-123',
      });

      expect(result).toEqual(
        err({
          code: 'verification_failed',
          message: 'GitHub API unavailable',
        })
      );
    });

    it('returns null when the candidate PR is closed or merged', async () => {
      const task = createTask({ prNumber: 1131 });
      delete (task as unknown as { linearIssueId?: string }).linearIssueId;
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'closed',
          mergedAt: new Date('2026-03-10T12:00:00.000Z'),
          headRef: 'task_closed_branch',
        })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task,
        userId: 'user-123',
      });

      expect(result).toEqual(ok(null));
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 1131, state: 'closed' }),
        'Continuation PR candidate is closed or merged'
      );
    });

    it('walks lineage ancestors, skips failed loads, and avoids duplicate revisits', async () => {
      const ancestorTask = createTask({
        id: 'task_parent',
        prNumber: 1144,
        retriedFrom: 'task_retry_parent',
      });
      const currentTask = createTask({
        retriedFrom: 'task_retry_parent',
        parentTaskId: 'task_parent',
      });
      delete (currentTask as unknown as { prNumber?: number }).prNumber;

      mockCodeTaskRepo.findById
        .mockResolvedValueOnce(
          err({ code: 'NOT_FOUND', message: 'task_retry_parent missing' })
        )
        .mockResolvedValueOnce(ok(ancestorTask));
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_parent_branch',
        })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: currentTask,
        userId: 'user-123',
      });

      expect(result).toEqual(
        ok({
          prNumber: 1144,
          prBranch: 'task_parent_branch',
        })
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ ancestorId: 'task_retry_parent', taskId: 'task_current' }),
        'Failed to load continuation PR lineage task'
      );
      expect(mockCodeTaskRepo.findById).toHaveBeenCalledTimes(2);
    });

    it('returns github_token_unavailable when GitHub OAuth token cannot be loaded', async () => {
      mockUserServiceClient.getOAuthToken.mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub token' })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask({ prNumber: 1131 }),
        userId: 'user-123',
      });

      expect(result).toEqual(
        err({
          code: 'github_token_unavailable',
          message: 'GitHub OAuth token is required to verify continuation PR state',
        })
      );
      expect(mockGitHubPRClient.getPullRequestStatus).not.toHaveBeenCalled();
    });

    it('returns null and logs a warning when same-ticket lookup fails', async () => {
      mockCodeTaskRepo.findRecentTasksByLinearIssue.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Firestore unavailable' })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask(),
        userId: 'user-123',
      });

      expect(result).toEqual(ok(null));
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ linearIssueId: 'INT-824' }),
        'Failed to load same-ticket tasks for continuation PR lookup'
      );
    });

    it('returns github_token_unavailable when same-ticket verification cannot fetch a token', async () => {
      mockCodeTaskRepo.findRecentTasksByLinearIssue.mockResolvedValue(
        ok([
          createTask({
            id: 'task_same_ticket',
            prNumber: 1139,
          }),
        ])
      );
      mockUserServiceClient.getOAuthToken.mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub token' })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask(),
        userId: 'user-123',
      });

      expect(result).toEqual(
        err({
          code: 'github_token_unavailable',
          message: 'GitHub OAuth token is required to verify continuation PR state',
        })
      );
      expect(mockGitHubPRClient.getPullRequestStatus).not.toHaveBeenCalled();
    });

    it('continues past a closed same-ticket PR candidate before reusing the next open PR', async () => {
      mockCodeTaskRepo.findRecentTasksByLinearIssue.mockResolvedValue(
        ok([
          createTask({
            id: 'task_closed_same_ticket',
            prNumber: 1138,
          }),
          createTask({
            id: 'task_open_same_ticket',
            prNumber: 1139,
          }),
        ])
      );
      mockGitHubPRClient.getPullRequestStatus
        .mockResolvedValueOnce(
          ok({
            state: 'closed',
            mergedAt: new Date('2026-03-10T10:00:00.000Z'),
            headRef: 'task_closed_branch',
          })
        )
        .mockResolvedValueOnce(
          ok({
            state: 'open',
            mergedAt: null,
            headRef: 'task_same_ticket_open_branch',
          })
        );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask(),
        userId: 'user-123',
      });

      expect(result).toEqual(
        ok({
          prNumber: 1139,
          prBranch: 'task_same_ticket_open_branch',
        })
      );
      expect(mockGitHubPRClient.getPullRequestStatus).toHaveBeenCalledTimes(2);
    });

    it('returns null after exhausting same-ticket candidates without finding an open PR', async () => {
      mockCodeTaskRepo.findRecentTasksByLinearIssue.mockResolvedValue(
        ok([
          createTask({ id: 'task_current', prNumber: 1131 }),
          createTask({ id: 'task_different_repo', repository: 'someone/else', prNumber: 1132 }),
          createTask({ id: 'task_without_pr' }),
          createTask({ id: 'task_closed_same_ticket', prNumber: 1133 }),
        ])
      );
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'closed',
          mergedAt: new Date('2026-03-10T12:30:00.000Z'),
          headRef: 'task_closed_same_ticket_branch',
        })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask(),
        userId: 'user-123',
      });

      expect(result).toEqual(ok(null));
      expect(mockGitHubPRClient.getPullRequestStatus).toHaveBeenCalledTimes(1);
    });

    it('skips seen, repo-mismatched, and pr-less same-ticket candidates before reusing a valid PR', async () => {
      mockCodeTaskRepo.findRecentTasksByLinearIssue.mockResolvedValue(
        ok([
          createTask({ id: 'task_current', prNumber: 900 }),
          createTask({ id: 'task_other_repo', repository: 'someone/else', prNumber: 901 }),
          createTask({ id: 'task_without_pr' }),
          createTask({ id: 'task_valid', prNumber: 1139 }),
        ])
      );
      mockGitHubPRClient.getPullRequestStatus.mockResolvedValue(
        ok({
          state: 'open',
          mergedAt: null,
          headRef: 'task_valid_branch',
        })
      );

      const result = await resolveContinuationPr(createResolveDeps(), {
        task: createTask(),
        userId: 'user-123',
      });

      expect(result).toEqual(
        ok({
          prNumber: 1139,
          prBranch: 'task_valid_branch',
        })
      );
      expect(mockGitHubPRClient.getPullRequestStatus).toHaveBeenCalledTimes(1);
      expect(mockGitHubPRClient.getPullRequestStatus).toHaveBeenCalledWith(
        'gh-token',
        'pbuchman',
        'intexuraos',
        1139
      );
    });
  });

  describe('postContinuationPrComment', () => {
    it('returns comment_failed when repository format is invalid', async () => {
      const result = await postContinuationPrComment(createCommentDeps(), {
        repository: 'invalid-repository',
        prNumber: 1139,
        taskId: 'task_retry_1',
        userId: 'user-123',
        commentTitle: 'Execution Retry Task Created',
      });

      expect(result).toEqual(
        err({
          code: 'comment_failed',
          message: 'Invalid repository format: invalid-repository',
        })
      );
    });

    it('returns github_token_unavailable when OAuth token lookup fails', async () => {
      mockUserServiceClient.getOAuthToken.mockResolvedValue(
        err({ code: 'CONNECTION_NOT_FOUND', message: 'No GitHub token' })
      );

      const result = await postContinuationPrComment(createCommentDeps(), {
        repository: 'pbuchman/intexuraos',
        prNumber: 1139,
        taskId: 'task_retry_1',
        userId: 'user-123',
        commentTitle: 'Execution Retry Task Created',
      });

      expect(result).toEqual(
        err({
          code: 'github_token_unavailable',
          message: 'GitHub OAuth token is required to post continuation PR comment',
        })
      );
    });

    it('returns comment_failed when GitHub rejects the continuation comment', async () => {
      mockGitHubPRClient.postPRComment.mockResolvedValue(
        err({ code: 'API_ERROR', message: 'Comment rejected' })
      );

      const result = await postContinuationPrComment(createCommentDeps(), {
        repository: 'pbuchman/intexuraos',
        prNumber: 1139,
        taskId: 'task_retry_1',
        userId: 'user-123',
        commentTitle: 'Execution Retry Task Created',
      });

      expect(result).toEqual(
        err({
          code: 'comment_failed',
          message: 'Comment rejected',
        })
      );
    });

    it('posts the continuation comment with the Linear issue when provided', async () => {
      const result = await postContinuationPrComment(createCommentDeps(), {
        repository: 'pbuchman/intexuraos',
        prNumber: 1139,
        taskId: 'task_retry_1',
        userId: 'user-123',
        linearIssueId: 'INT-824',
        commentTitle: 'Execution Retry Task Created',
      });

      expect(result).toEqual(ok(undefined));
      expect(mockGitHubPRClient.postPRComment).toHaveBeenCalledWith(
        'gh-token',
        'pbuchman',
        'intexuraos',
        1139,
        expect.stringContaining('**Linear Issue:** INT-824')
      );
      expect(mockGitHubPRClient.postPRComment).toHaveBeenCalledWith(
        'gh-token',
        'pbuchman',
        'intexuraos',
        1139,
        expect.stringContaining('@ignore')
      );
    });

    it('omits the Linear issue line when it is not provided', async () => {
      await postContinuationPrComment(createCommentDeps(), {
        repository: 'pbuchman/intexuraos',
        prNumber: 1139,
        taskId: 'task_retry_1',
        userId: 'user-123',
        commentTitle: 'Execution Retry Task Created',
      });

      const commentBody = mockGitHubPRClient.postPRComment.mock.calls[0]?.[4] as string;
      expect(commentBody).not.toContain('**Linear Issue:**');
      expect(commentBody).toContain('Execution Retry Task Created');
    });
  });
});
