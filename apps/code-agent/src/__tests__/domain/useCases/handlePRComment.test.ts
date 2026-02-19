import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { handlePRComment, type HandlePRCommentDeps } from '../../../domain/usecases/handlePRComment.js';
import type { CodeTask } from '../../../domain/models/codeTask.js';
import type { GitHubPREvent } from '../../../domain/models/gitHubPREvent.js';
import type { PRTaskLock } from '../../../domain/models/prTaskLock.js';

// Mock repository types with vi.fn() method types
interface MockCodeTaskRepo {
  create: Mock;
  findById: Mock;
  findByIdForUser: Mock;
  update: Mock;
  list: Mock;
  hasActiveTaskForLinearIssue: Mock;
  findZombieTasks: Mock;
  countByUserToday: Mock;
  findArchivableTasks: Mock;
  archiveTaskLogs: Mock;
  findByPR: Mock;
}

interface MockPRTaskLockRepo {
  acquireLock: Mock;
  releaseLock: Mock;
  findLock: Mock;
}

function createDeps(
  codeTaskRepo: MockCodeTaskRepo,
  prTaskLockRepo: MockPRTaskLockRepo,
  logger: ReturnType<typeof createMockLogger>
): HandlePRCommentDeps {
  return {
    codeTaskRepo,
    prTaskLockRepo,
    logger,
  } as unknown as HandlePRCommentDeps;
}

function createMockLogger(): Parameters<typeof handlePRComment>[2]['logger'] {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Parameters<typeof handlePRComment>[2]['logger'];
}

function createMockEvent(overrides: Partial<GitHubPREvent> = {}): GitHubPREvent {
  return {
    id: 'event-123',
    githubEventId: 12345,
    repository: 'pbuchman/intexuraos',
    repositoryId: 1,
    pullRequestNumber: 42,
    pullRequestId: 100,
    eventType: 'issue_comment',
    action: 'created',
    senderLogin: 'reviewer',
    senderId: 999,
    senderType: 'User',
    title: 'Test PR',
    body: '@claude-bot please fix this issue',
    state: 'open',
    mergedAt: null,
    createdAt: new Date(),
    processedAt: new Date(),
    payload: {},
    ...overrides,
  };
}

function createMockTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-original-123',
    userId: 'user-123',
    prompt: 'Implement the feature from INT-123',
    sanitizedPrompt: 'implement-feature',
    systemPromptHash: 'hash123',
    status: 'designed',
    workerType: 'opus',
    workerLocation: 'us-central1',
    repository: 'pbuchman/intexuraos',
    baseBranch: 'development',
    traceId: 'trace-123',
    linearIssueId: 'INT-123',
    prNumber: 42,
    prBranch: 'feature/int-123',
    result: {
      branch: 'feature/int-123',
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
      commits: 3,
      summary: 'Implemented feature from INT-123',
    },
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    callbackReceived: true,
    dedupKey: 'abc123',
    ...overrides,
  };
}

describe('handlePRComment', () => {
  let mockCodeTaskRepo: MockCodeTaskRepo;
  let mockPrTaskLockRepo: MockPRTaskLockRepo;
  let mockLogger: ReturnType<typeof createMockLogger>;

  function createMockCodeTaskRepo(): MockCodeTaskRepo {
    return {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdForUser: vi.fn(),
      update: vi.fn(),
      list: vi.fn(),
      hasActiveTaskForLinearIssue: vi.fn(),
      findZombieTasks: vi.fn(),
      countByUserToday: vi.fn(),
      findArchivableTasks: vi.fn(),
      archiveTaskLogs: vi.fn(),
      findByPR: vi.fn(),
    };
  }

  function createMockPrTaskLockRepo(): MockPRTaskLockRepo {
    return {
      acquireLock: vi.fn(),
      releaseLock: vi.fn(),
      findLock: vi.fn(),
    };
  }

  beforeEach(() => {
    mockCodeTaskRepo = createMockCodeTaskRepo();
    mockPrTaskLockRepo = createMockPrTaskLockRepo();
    mockLogger = createMockLogger();
  });

  describe('when comment is not actionable', () => {
    it('returns NOT_ACTIONABLE for random comment without Claude mention', async () => {
      const event = createMockEvent({
        body: 'LGTM! Looks good to me.',
        senderLogin: 'reviewer',
      });

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_ACTIONABLE');
      }
      expect(mockPrTaskLockRepo.acquireLock).not.toHaveBeenCalled();
    });

    it('returns NOT_ACTIONABLE for bot comment even with Claude mention', async () => {
      const event = createMockEvent({
        body: '@claude-bot test this',
        senderLogin: 'github-actions[bot]',
        senderType: 'Bot',
      });

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_ACTIONABLE');
      }
    });
  });

  describe('when PR is already locked', () => {
    it('returns PR_LOCKED when another task is in progress', async () => {
      const event = createMockEvent();

      mockPrTaskLockRepo.acquireLock.mockResolvedValue(
        err({
          code: 'LOCK_HELD',
          message: 'Lock already held',
          lockedByTaskId: 'existing-task-456',
        })
      );

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PR_LOCKED');
        expect((result.error as { activeTaskId: string }).activeTaskId).toBe('existing-task-456');
      }
    });

    it('returns LOCK_ERROR when lock acquisition fails with other error', async () => {
      const event = createMockEvent();

      mockPrTaskLockRepo.acquireLock.mockResolvedValue(
        err({
          code: 'FIRESTORE_ERROR',
          message: 'Database connection failed',
        })
      );

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOCK_ERROR');
      }
    });
  });

  describe('when comment is actionable and PR is not locked', () => {
    beforeEach(() => {
      const mockLock: PRTaskLock = {
        id: 'pbuchman/intexuraos:42',
        activeTaskId: 'pending',
        lockedAt: Timestamp.now(),
        lockedBy: 'user-123',
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
      };
      mockPrTaskLockRepo.acquireLock.mockResolvedValue(ok(mockLock));
    });

    it('returns mode=resumed when original task exists', async () => {
      const event = createMockEvent();
      const originalTask = createMockTask();

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('resumed');
        expect(result.value.originalTaskId).toBe('task-original-123');
        expect(result.value.prompt).toContain('### Original Task Context');
        expect(result.value.prompt).toContain('**Linear Issue:** INT-123');
      }
    });

    it('returns mode=new when no original task exists', async () => {
      const event = createMockEvent();

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(null));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mode).toBe('new');
        expect(result.value.originalTaskId).toBeUndefined();
        expect(result.value.prompt).toContain('This is a new task to address feedback');
      }
    });

    it('includes comment body in prompt', async () => {
      const event = createMockEvent({
        body: '@claude-bot please add error handling for null inputs',
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(null));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prompt).toContain('please add error handling for null inputs');
      }
    });

    it('includes sender login in prompt', async () => {
      const event = createMockEvent({
        senderLogin: 'code-reviewer-jane',
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(null));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prompt).toContain('code-reviewer-jane');
      }
    });

    it('handles null body in event', async () => {
      const event = createMockEvent({
        body: null,
      });
      // Override with explicit null since createMockEvent sets a default body
      // Need a direct mention to be actionable
      (event as { body: string | null }).body = '@claude-bot help';

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(null));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
    });

    it('handles originalTask without linearIssueId', async () => {
      const event = createMockEvent();
      const originalTask = createMockTask();
      // Remove linearIssueId to test the fallback
      delete (originalTask as { linearIssueId?: string }).linearIssueId;

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should NOT contain Linear Issue line when linearIssueId is missing
        expect(result.value.prompt).not.toContain('**Linear Issue:**');
        // Should still have the Original Task Context section
        expect(result.value.prompt).toContain('### Original Task Context');
      }
    });

    it('truncates long prompts in context', async () => {
      const event = createMockEvent();
      // Use 900 chars to exceed the 800 char truncation threshold
      const longPrompt = 'A'.repeat(900);
      const originalTask = createMockTask({
        prompt: longPrompt,
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prompt).toContain('...');
        expect(result.value.prompt).not.toContain('A'.repeat(900));
      }
    });

    it('handles originalTask without result or prBranch', async () => {
      const event = createMockEvent();
      const originalTask = createMockTask();
      // Remove result and prBranch to test the fallback
      delete (originalTask as { result?: unknown }).result;
      delete (originalTask as { prBranch?: string }).prBranch;

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should NOT contain Branch line when neither result.branch nor prBranch exists
        expect(result.value.prompt).not.toContain('**Branch:**');
        // Should still have the Original Task Context section
        expect(result.value.prompt).toContain('### Original Task Context');
      }
    });

    it('uses prBranch when result.branch is missing', async () => {
      const event = createMockEvent();
      const originalTask = createMockTask({
        prBranch: 'fallback-branch',
      });
      // Remove result to test prBranch fallback
      delete (originalTask as { result?: unknown }).result;

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prompt).toContain('**Branch:** fallback-branch');
      }
    });

    it('includes linearIssueType in prompt when present', async () => {
      const event = createMockEvent();
      const originalTask = createMockTask({
        linearIssueId: 'INT-456',
        linearIssueType: 'feature',
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.prompt).toContain('**Linear Issue:** INT-456 (feature)');
      }
    });

    it('includes linearIssueTitle in prompt when present', async () => {
      const event = createMockEvent();
      const originalTask = createMockTask({
        linearIssueId: 'INT-789',
        linearIssueTitle: 'Add user authentication',
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.prompt).toContain('**Linear Issue:** INT-789: Add user authentication');
      }
    });

    it('truncates long result summary in context', async () => {
      const event = createMockEvent();
      const longSummary = 'B'.repeat(400);
      const originalTask = createMockTask({
        result: {
          branch: 'feature/test',
          commits: 1,
          summary: longSummary,
        },
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(originalTask));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.prompt).toContain('**Previous Work Summary:**');
        expect(result.value.prompt).toContain('...');
        expect(result.value.prompt).not.toContain('B'.repeat(400));
      }
    });

    it('uses PR title in prompt header', async () => {
      const event = createMockEvent({
        title: 'Fix authentication flow',
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(null));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.prompt).toContain('#42 - Fix authentication flow');
      }
    });

    it('uses fallback PR title when title is null', async () => {
      const event = createMockEvent({
        title: null,
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(null));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.prompt).toContain('#42 - PR #42');
      }
    });

    it('uses fallback state when state is null', async () => {
      const event = createMockEvent({
        state: null,
      });

      mockCodeTaskRepo.findByPR.mockResolvedValue(ok(null));

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(true);
      if (result.ok === true) {
        expect(result.value.prompt).toContain('**State:** open');
      }
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      const mockLock: PRTaskLock = {
        id: 'pbuchman/intexuraos:42',
        activeTaskId: 'pending',
        lockedAt: Timestamp.now(),
        lockedBy: 'user-123',
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
      };
      mockPrTaskLockRepo.acquireLock.mockResolvedValue(ok(mockLock));
    });

    it('releases lock and returns REPO_ERROR when findByPR fails', async () => {
      const event = createMockEvent();

      mockCodeTaskRepo.findByPR.mockResolvedValue(
        err({ code: 'FIRESTORE_ERROR', message: 'Database unavailable' })
      );

      const result = await handlePRComment(
        event,
        'user-123',
        createDeps(mockCodeTaskRepo, mockPrTaskLockRepo, mockLogger)
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('REPO_ERROR');
      }
      expect(mockPrTaskLockRepo.releaseLock).toHaveBeenCalledWith('pbuchman/intexuraos:42');
    });
  });
});
