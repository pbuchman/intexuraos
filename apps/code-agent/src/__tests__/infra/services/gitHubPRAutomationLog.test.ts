/**
 * Tests for GitHubPRAutomationLog
 *
 * Verifies the create-new vs get-append-update flow,
 * best-effort error handling, and Firestore/GitHub coordination.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { createGitHubPRAutomationLog } from '../../../infra/services/gitHubPRAutomationLog.js';
import { createMockLogger } from '../../helpers/mockLogger.js';
import type { GitHubPRClient, GitHubPRClientError } from '../../../domain/ports/gitHubPRClient.js';
import type { PRAutomationCommentRepository, PRAutomationComment } from '../../../domain/ports/prAutomationCommentRepository.js';
import type { AutomationLog, PRRef, AutomationEvent } from '../../../domain/ports/automationLog.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function createFakeGitHubPRClient(overrides?: Partial<GitHubPRClient>): GitHubPRClient {
  return {
    updatePRTitle: vi.fn().mockResolvedValue(ok(undefined)),
    getPullRequestFiles: vi.fn().mockResolvedValue(ok([])),
    getPullRequestCommits: vi.fn().mockResolvedValue(ok([])),
    getPullRequestBaseBranch: vi.fn().mockResolvedValue(ok('main')),
    getPullRequestStatus: vi.fn().mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'branch' })),
    postPRComment: vi.fn().mockResolvedValue(ok({ commentId: 100 })),
    listOpenPullRequestsByBaseBranch: vi.fn().mockResolvedValue(ok([])),
    getPullRequestDetails: vi.fn().mockResolvedValue(ok({ number: 1, title: '', body: null, authorLogin: '', baseBranch: 'main', headBranch: 'branch', mergeable: null, mergeableState: null, headSha: 'sha123' })),
    getIssueComment: vi.fn().mockResolvedValue(ok({ body: '@ignore\n### IntexuraOS Automation\n\n**12:00** -- existing line' })),
    updateIssueComment: vi.fn().mockResolvedValue(ok({ commentId: 100 })),
    mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'abc123', merged: true })),
    getCombinedCheckStatus: vi.fn().mockResolvedValue(ok({ state: 'success' })),
    listAllOpenPullRequests: vi.fn().mockResolvedValue(ok([])),
    ...overrides,
  };
}

function createFakeRepo(): PRAutomationCommentRepository & {
  store: Map<string, PRAutomationComment>;
} {
  const store = new Map<string, PRAutomationComment>();
  return {
    store,
    async get(repository: string, prNumber: number): Promise<PRAutomationComment | undefined> {
      return store.get(`${repository}:${String(prNumber)}`);
    },
    async create(comment: PRAutomationComment): Promise<void> {
      store.set(`${comment.repository}:${String(comment.prNumber)}`, comment);
    },
    async update(repository: string, prNumber: number, fields: { eventCount: number; updatedAt: string }): Promise<void> {
      const key = `${repository}:${String(prNumber)}`;
      const existing = store.get(key);
      if (existing !== undefined) {
        store.set(key, { ...existing, ...fields });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const prRef: PRRef = { repository: 'pbuchman/intexuraos', prNumber: 42 };
const webhookEvent: AutomationEvent = {
  type: 'webhook_received',
  eventType: 'pull_request',
  action: 'opened',
  sender: 'pbuchman',
  deliveryId: 'delivery-123',
};

describe('GitHubPRAutomationLog', () => {
  const logger = createMockLogger();
  let gitHubPRClient: GitHubPRClient;
  let repo: ReturnType<typeof createFakeRepo>;
  const resolveOAuthToken = vi.fn().mockResolvedValue('ghp_test_token');
  const tokenUserId = 'user-123';

  beforeEach(() => {
    gitHubPRClient = createFakeGitHubPRClient();
    repo = createFakeRepo();
    vi.clearAllMocks();
    resolveOAuthToken.mockResolvedValue('ghp_test_token');
  });

  function createLog(): AutomationLog {
    return createGitHubPRAutomationLog({
      gitHubPRClient,
      prAutomationCommentRepo: repo,
      resolveOAuthToken,
      logger,
    });
  }

  describe('first event for a PR (create flow)', () => {
    it('should POST a new comment with header + event line', async () => {
      const log = createLog();
      await log.record(prRef, webhookEvent, tokenUserId);

      const postPRComment = gitHubPRClient.postPRComment as ReturnType<typeof vi.fn>;
      expect(postPRComment).toHaveBeenCalledOnce();

      const [token, owner, repo, prNumber, body] = postPRComment.mock.calls[0] as [string, string, string, number, string];
      expect(token).toBe('ghp_test_token');
      expect(owner).toBe('pbuchman');
      expect(repo).toBe('intexuraos');
      expect(prNumber).toBe(42);
      expect(body).toContain('@ignore');
      expect(body).toContain('### IntexuraOS Automation');
      expect(body).toContain('PR opened by @pbuchman');
    });

    it('should save comment record to Firestore', async () => {
      const log = createLog();
      await log.record(prRef, webhookEvent, tokenUserId);

      const stored = await repo.get('pbuchman/intexuraos', 42);
      expect(stored).toBeDefined();
      expect(stored?.commentId).toBe(100);
      expect(stored?.tokenUserId).toBe('user-123');
      expect(stored?.eventCount).toBe(1);
      expect(stored?.repository).toBe('pbuchman/intexuraos');
      expect(stored?.prNumber).toBe(42);
    });

    it('should not call getIssueComment or updateIssueComment', async () => {
      const log = createLog();
      await log.record(prRef, webhookEvent, tokenUserId);

      expect(gitHubPRClient.getIssueComment).not.toHaveBeenCalled();
      expect(gitHubPRClient.updateIssueComment).not.toHaveBeenCalled();
    });
  });

  describe('subsequent event for a PR (append flow)', () => {
    beforeEach(async () => {
      // Pre-populate Firestore with an existing comment
      await repo.create({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        commentId: 100,
        tokenUserId: 'user-123',
        eventCount: 1,
        createdAt: '2026-03-14T12:00:00.000Z',
        updatedAt: '2026-03-14T12:00:00.000Z',
      });
    });

    it('should GET existing comment, append event line, and PATCH', async () => {
      const triageEvent: AutomationEvent = {
        type: 'triage_dispatch',
        reviewTypes: ['code_review'],
        cost: 0.05,
        reasoning: 'Needs review.',
        toolCalls: [],
      };

      const log = createLog();
      await log.record(prRef, triageEvent);

      // Should GET the existing comment
      const getIssueComment = gitHubPRClient.getIssueComment as ReturnType<typeof vi.fn>;
      expect(getIssueComment).toHaveBeenCalledWith('ghp_test_token', 'pbuchman', 'intexuraos', 100);

      // Should PATCH with appended line
      const updateIssueComment = gitHubPRClient.updateIssueComment as ReturnType<typeof vi.fn>;
      expect(updateIssueComment).toHaveBeenCalledOnce();
      const [, , , , body] = updateIssueComment.mock.calls[0] as [string, string, string, number, string];
      expect(body).toContain('existing line');
      expect(body).toContain('dispatching review');
    });

    it('should update Firestore eventCount', async () => {
      const log = createLog();
      await log.record(prRef, { type: 'task_started', taskId: 'task_abc', workerType: 'opus', attempt: 1 });

      const stored = await repo.get('pbuchman/intexuraos', 42);
      expect(stored?.eventCount).toBe(2);
    });

    it('should not call postPRComment', async () => {
      const log = createLog();
      await log.record(prRef, webhookEvent);

      expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    });
  });

  describe('filtered events (renderEvent returns null)', () => {
    it('should skip recording entirely for hard_rules skipped event', async () => {
      const log = createLog();
      const hardRulesEvent: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'hard_rules',
        reason: 'PROTECTED_BASE_BRANCH',
        ruleName: 'ProtectedBaseBranchRule',
      };

      await log.record(prRef, hardRulesEvent, tokenUserId);

      expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
      expect(gitHubPRClient.getIssueComment).not.toHaveBeenCalled();
      expect(gitHubPRClient.updateIssueComment).not.toHaveBeenCalled();
    });

    it('should skip recording entirely for webhook_route skipped event', async () => {
      const log = createLog();
      const webhookRouteEvent: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'webhook_route',
        reason: 'UNSUPPORTED_EVENT',
      };

      await log.record(prRef, webhookRouteEvent, tokenUserId);

      expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
      expect(gitHubPRClient.getIssueComment).not.toHaveBeenCalled();
      expect(gitHubPRClient.updateIssueComment).not.toHaveBeenCalled();
    });

    it('should still record llm_triage skipped events', async () => {
      const log = createLog();
      const llmTriageEvent: AutomationEvent = {
        type: 'skipped',
        decidedBy: 'llm_triage',
        reason: 'NO_ACTION_NEEDED',
        cost: 0.042,
        reasoning: 'Documentation-only change.',
        toolCalls: [],
      };

      await log.record(prRef, llmTriageEvent, tokenUserId);

      const postPRComment = gitHubPRClient.postPRComment as ReturnType<typeof vi.fn>;
      expect(postPRComment).toHaveBeenCalledOnce();
      const [, , , , body] = postPRComment.mock.calls[0] as [string, string, string, number, string];
      expect(body).toContain('**Skipped** | NO_ACTION_NEEDED');
    });
  });

  describe('tokenUserId resolution', () => {
    it('should skip when no tokenUserId is available for new comment', async () => {
      const log = createLog();
      await expect(log.record(prRef, webhookEvent)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
        expect.stringContaining('no tokenUserId')
      );
      expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    });

    it('should skip when empty tokenUserId is provided for new comment', async () => {
      const log = createLog();
      await expect(log.record(prRef, webhookEvent, '')).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
        expect.stringContaining('no tokenUserId')
      );
      expect(gitHubPRClient.postPRComment).not.toHaveBeenCalled();
    });

    it('should use stored tokenUserId from Firestore for existing comments', async () => {
      await repo.create({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        commentId: 100,
        tokenUserId: 'stored-user',
        eventCount: 1,
        createdAt: '2026-03-14T12:00:00.000Z',
        updatedAt: '2026-03-14T12:00:00.000Z',
      });

      const log = createLog();
      // No tokenUserId passed — should use 'stored-user' from Firestore doc
      await log.record(prRef, webhookEvent);

      expect(resolveOAuthToken).toHaveBeenCalledWith('stored-user');
    });
  });

  describe('error handling (best-effort)', () => {
    it('should not throw when OAuth token resolution fails', async () => {
      resolveOAuthToken.mockResolvedValue(null);

      const log = createLog();
      await expect(log.record(prRef, webhookEvent, tokenUserId)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'pbuchman/intexuraos', prNumber: 42 }),
        expect.stringContaining('token')
      );
    });

    it('should not throw when postPRComment fails', async () => {
      gitHubPRClient = createFakeGitHubPRClient({
        postPRComment: vi.fn().mockResolvedValue(err({ code: 'API_ERROR', message: 'GitHub is down' } satisfies GitHubPRClientError)),
      });

      const log = createLog();
      await expect(log.record(prRef, webhookEvent, tokenUserId)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not throw when getIssueComment fails on append', async () => {
      await repo.create({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        commentId: 100,
        tokenUserId: 'user-123',
        eventCount: 1,
        createdAt: '2026-03-14T12:00:00.000Z',
        updatedAt: '2026-03-14T12:00:00.000Z',
      });

      gitHubPRClient = createFakeGitHubPRClient({
        getIssueComment: vi.fn().mockResolvedValue(err({ code: 'NOT_FOUND', message: 'Comment deleted' } satisfies GitHubPRClientError)),
      });

      const log = createLog();
      await expect(log.record(prRef, webhookEvent)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not throw when updateIssueComment fails on append', async () => {
      await repo.create({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        commentId: 100,
        tokenUserId: 'user-123',
        eventCount: 1,
        createdAt: '2026-03-14T12:00:00.000Z',
        updatedAt: '2026-03-14T12:00:00.000Z',
      });

      gitHubPRClient = createFakeGitHubPRClient({
        updateIssueComment: vi.fn().mockResolvedValue(err({ code: 'RATE_LIMITED', message: 'Rate limited' } satisfies GitHubPRClientError)),
      });

      const log = createLog();
      await expect(log.record(prRef, webhookEvent)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not throw when an unexpected error occurs', async () => {
      gitHubPRClient = createFakeGitHubPRClient({
        postPRComment: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
      });

      const log = createLog();
      await expect(log.record(prRef, webhookEvent, tokenUserId)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('owner/repo parsing', () => {
    it('should correctly split repository into owner and repo', async () => {
      const orgRef: PRRef = { repository: 'my-org/my-repo', prNumber: 7 };
      const log = createLog();
      await log.record(orgRef, webhookEvent, tokenUserId);

      const postPRComment = gitHubPRClient.postPRComment as ReturnType<typeof vi.fn>;
      const [, owner, repo] = postPRComment.mock.calls[0] as [string, string, string];
      expect(owner).toBe('my-org');
      expect(repo).toBe('my-repo');
    });

    it('should skip recording when repository has no slash', async () => {
      const badRef: PRRef = { repository: 'noslash', prNumber: 1 };
      const log = createLog();
      await log.record(badRef, webhookEvent, tokenUserId);

      const postPRComment = gitHubPRClient.postPRComment as ReturnType<typeof vi.fn>;
      expect(postPRComment).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ repository: 'noslash' }),
        expect.stringContaining('invalid repository format'),
      );
    });
  });

  describe('concurrency', () => {
    it('should serialize concurrent record() calls for the same PR', async () => {
      const log = createLog();

      const taskStartedEvent: AutomationEvent = {
        type: 'task_started',
        taskId: 'task_abc',
        workerType: 'opus',
        attempt: 1,
      };

      // Fire two record() calls concurrently — no await between them
      await Promise.all([
        log.record(prRef, webhookEvent, tokenUserId),
        log.record(prRef, taskStartedEvent, tokenUserId),
      ]);

      // First call should create a new comment
      const postPRComment = gitHubPRClient.postPRComment as ReturnType<typeof vi.fn>;
      expect(postPRComment).toHaveBeenCalledOnce();

      // Second call should append to the existing comment (GET + PATCH)
      const getIssueComment = gitHubPRClient.getIssueComment as ReturnType<typeof vi.fn>;
      expect(getIssueComment).toHaveBeenCalledOnce();

      const updateIssueComment = gitHubPRClient.updateIssueComment as ReturnType<typeof vi.fn>;
      expect(updateIssueComment).toHaveBeenCalledOnce();

      // Firestore: create once, update once
      const stored = await repo.get('pbuchman/intexuraos', 42);
      expect(stored).toBeDefined();
      expect(stored?.eventCount).toBe(2);
    });

    it('should not serialize calls for different PRs', async () => {
      const log = createLog();
      const prRef2: PRRef = { repository: 'pbuchman/intexuraos', prNumber: 99 };

      await Promise.all([
        log.record(prRef, webhookEvent, tokenUserId),
        log.record(prRef2, webhookEvent, tokenUserId),
      ]);

      // Each PR should get its own new comment
      const postPRComment = gitHubPRClient.postPRComment as ReturnType<typeof vi.fn>;
      expect(postPRComment).toHaveBeenCalledTimes(2);

      // Neither should try to append
      const getIssueComment = gitHubPRClient.getIssueComment as ReturnType<typeof vi.fn>;
      expect(getIssueComment).not.toHaveBeenCalled();

      const updateIssueComment = gitHubPRClient.updateIssueComment as ReturnType<typeof vi.fn>;
      expect(updateIssueComment).not.toHaveBeenCalled();
    });

    it('should not block subsequent calls when a prior call fails', async () => {
      gitHubPRClient = createFakeGitHubPRClient({
        postPRComment: vi.fn()
          .mockRejectedValueOnce(new Error('GitHub is down'))
          .mockResolvedValueOnce(ok({ commentId: 200 })),
      });
      const log = createLog();

      // First call will throw inside doRecord (caught by try-catch, logged as warning).
      // Second call must still succeed — not blocked by the first failure.
      await Promise.all([
        log.record(prRef, webhookEvent, tokenUserId),
        log.record(prRef, { type: 'task_started', taskId: 'task_abc', workerType: 'opus', attempt: 1 }, tokenUserId),
      ]);

      const postPRComment = gitHubPRClient.postPRComment as ReturnType<typeof vi.fn>;
      expect(postPRComment).toHaveBeenCalledTimes(2);

      // Second call should still have created a comment (first failed, no Firestore doc)
      const stored = await repo.get('pbuchman/intexuraos', 42);
      expect(stored).toBeDefined();
      expect(stored?.commentId).toBe(200);
    });
  });

  describe('render options', () => {
    it('should pass repository to renderEvent for commit links', async () => {
      await repo.create({
        repository: 'pbuchman/intexuraos',
        prNumber: 42,
        commentId: 100,
        tokenUserId: 'user-123',
        eventCount: 1,
        createdAt: '2026-03-14T12:00:00.000Z',
        updatedAt: '2026-03-14T12:00:00.000Z',
      });

      const completedEvent: AutomationEvent = {
        type: 'task_completed',
        taskId: 'task_abc',
        status: 'implemented',
        duration: 522000,
        prUrl: 'https://github.com/pbuchman/intexuraos/pull/42',
        commits: [{ sha: 'abc1234567890', message: 'fix: add auth' }],
      };

      const log = createLog();
      await log.record(prRef, completedEvent);

      const updateIssueComment = gitHubPRClient.updateIssueComment as ReturnType<typeof vi.fn>;
      const [, , , , body] = updateIssueComment.mock.calls[0] as [string, string, string, number, string];
      expect(body).toContain('github.com/pbuchman/intexuraos/commit/abc1234567890');
    });
  });
});
