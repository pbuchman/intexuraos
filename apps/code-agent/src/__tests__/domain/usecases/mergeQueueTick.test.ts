/**
 * Tests for mergeQueueTick use case.
 *
 * Covers all branches: merge, skip, drain, error, 405 already-merged, 409 conflict.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { err, ok } from '@intexuraos/common-core';
import { Timestamp } from '@google-cloud/firestore';
import { createMergeQueueTick, type MergeQueueTickDeps } from '../../../domain/usecases/mergeQueueTick.js';
import type { MergeQueueWatchRepository } from '../../../domain/repositories/mergeQueueWatchRepository.js';
import type { GitHubPullRequestDetails } from '../../../domain/ports/gitHubPRClient.js';
import type { GitHubPRSummary } from '../../../domain/models/gitHubPRSummary.js';
import type { UserServiceClient } from '@intexuraos/internal-clients';
import type { MergeQueueWatch } from '../../../domain/models/mergeQueueWatch.js';

// Mock logger
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => mockLogger),
};

function makeWatch(overrides: Partial<MergeQueueWatch> = {}): MergeQueueWatch {
  return {
    id: 'watch_abc',
    userId: 'user-1',
    gitHubUsername: 'testuser',
    owner: 'testorg',
    repo: 'testrepo',
    baseBranch: 'main',
    status: 'active',
    mergedPrs: [],
    skippedPrs: [],
    excludedPrNumbers: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: Timestamp.now(),
    lastTickAt: null,
    drainedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function makePrSummary(overrides: Partial<GitHubPRSummary> = {}): GitHubPRSummary {
  return {
    repository: 'testorg/testrepo',
    pullRequestNumber: 1,
    title: 'Test PR',
    state: 'open',
    mergedAt: null,
    baseBranch: 'main',
    authorLogin: 'testuser',
    headBranch: 'feature',
    mergeConflictStatus: null,
    lastConflictCheckedAt: null,
    conflictEpisodeStartedAt: null,
    conflictResolvedAt: null,
    managedConflictCommentId: null,
    managedConflictTaskId: null,
    managedConflictTaskOwnerUserId: null,
    lastActivityAt: new Date('2026-03-14T00:00:00Z'),
    firstSeenAt: new Date('2026-03-14T00:00:00Z'),
    lastReviewedCommitSha: null,
    ...overrides,
  };
}

function makePrDetails(overrides: Partial<GitHubPullRequestDetails> = {}): GitHubPullRequestDetails {
  return {
    number: 1,
    title: 'Test PR',
    body: null,
    state: 'open',
    authorLogin: 'testuser',
    baseBranch: 'main',
    headBranch: 'feature',
    mergeable: true,
    mergeableState: 'clean',
    headSha: 'sha123',
    ...overrides,
  };
}

describe('mergeQueueTick', () => {
  let mockWatchRepo: {
    findAllActive: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    appendMergedPr: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findActiveByUserAndBranch: ReturnType<typeof vi.fn>;
    findByUserAndRepo: ReturnType<typeof vi.fn>;
  };

  let mockGitHubPRClient: {
    getPullRequestDetails: ReturnType<typeof vi.fn>;
    getCombinedCheckStatus: ReturnType<typeof vi.fn>;
    mergePullRequest: ReturnType<typeof vi.fn>;
  };

  let mockGitHubPRSummaryRepo: {
    findOpenByBaseBranch: ReturnType<typeof vi.fn>;
  };

  let mockUserServiceClient: {
    getOAuthToken: ReturnType<typeof vi.fn>;
    getApiKeys: ReturnType<typeof vi.fn>;
    getLlmClient: ReturnType<typeof vi.fn>;
    reportLlmSuccess: ReturnType<typeof vi.fn>;
    resolveGitHubUsername: ReturnType<typeof vi.fn>;
  };

  let deps: MergeQueueTickDeps;

  beforeEach(() => {
    vi.resetAllMocks();

    mockWatchRepo = {
      findAllActive: vi.fn(),
      update: vi.fn().mockResolvedValue(ok(undefined)),
      appendMergedPr: vi.fn().mockResolvedValue(ok(undefined)),
      create: vi.fn(),
      findById: vi.fn(),
      findActiveByUserAndBranch: vi.fn(),
      findByUserAndRepo: vi.fn(),
    };

    mockGitHubPRClient = {
      getPullRequestDetails: vi.fn(),
      getCombinedCheckStatus: vi.fn(),
      mergePullRequest: vi.fn(),
    };

    mockGitHubPRSummaryRepo = {
      findOpenByBaseBranch: vi.fn(),
    };

    mockUserServiceClient = {
      getOAuthToken: vi.fn(),
      getApiKeys: vi.fn(),
      getLlmClient: vi.fn(),
      reportLlmSuccess: vi.fn(),
      resolveGitHubUsername: vi.fn(),
    };

    deps = {
      mergeQueueWatchRepo: mockWatchRepo as unknown as MergeQueueWatchRepository,
      gitHubPRClient: mockGitHubPRClient as unknown as MergeQueueTickDeps['gitHubPRClient'],
      gitHubPRSummaryRepo: mockGitHubPRSummaryRepo as unknown as MergeQueueTickDeps['gitHubPRSummaryRepo'],
      userServiceClient: mockUserServiceClient as unknown as UserServiceClient,
      allowedBots: new Set(['renovate[bot]']),
      logger: mockLogger,
    };
  });

  it('returns empty array when no active watches', async () => {
    mockWatchRepo.findAllActive.mockResolvedValue(ok([]));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toEqual([]);
    }
  });

  it('merges the oldest eligible PR', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [
      makePrSummary({ pullRequestNumber: 10, title: 'PR 10', firstSeenAt: new Date('2026-03-14T00:00:00Z') }),
      makePrSummary({ pullRequestNumber: 20, title: 'PR 20', firstSeenAt: new Date('2026-03-16T00:00:00Z') }),
      makePrSummary({ pullRequestNumber: 30, title: 'PR 30', firstSeenAt: new Date('2026-03-18T00:00:00Z') }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(
      ok(makePrDetails({ number: 10, title: 'PR 10', headSha: 'sha-10' }))
    );
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));
    mockGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: 'merged-sha-10', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toHaveLength(1);
      const tickResult = result.value[0];
      expect(tickResult).toBeDefined();
      expect(tickResult?.action).toBe('merged');
      expect(tickResult?.mergedPrNumber).toBe(10);
      expect(tickResult?.remainingPrs).toBe(2);
    }

    expect(mockGitHubPRClient.mergePullRequest).toHaveBeenCalledWith('tok-123', 'testorg', 'testrepo', 10, 'merge');
    expect(mockWatchRepo.appendMergedPr).toHaveBeenCalledWith('watch_abc', expect.objectContaining({
      prNumber: 10,
      title: 'PR 10',
      author: 'testuser',
    }));
  });

  it('skips PRs from ineligible authors', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    // Only a PR from dependabot[bot] which is not in allowedBots
    const prs = [
      makePrSummary({ pullRequestNumber: 5, authorLogin: 'dependabot[bot]' }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value).toHaveLength(1);
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('drained');
    }

    // No merge attempt should have been made
    expect(mockGitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
  });

  it('skips conflicting PR and merges the next eligible one', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [
      makePrSummary({ pullRequestNumber: 1, lastActivityAt: new Date('2026-03-14T00:00:00Z') }),
      makePrSummary({ pullRequestNumber: 2, lastActivityAt: new Date('2026-03-16T00:00:00Z') }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    // First PR has merge conflict
    mockGitHubPRClient.getPullRequestDetails
      .mockResolvedValueOnce(ok(makePrDetails({ number: 1, mergeable: false })))
      .mockResolvedValueOnce(ok(makePrDetails({ number: 2, headSha: 'sha-2' })));

    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));
    mockGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: 'merged-sha-2', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('merged');
      expect(tickResult?.mergedPrNumber).toBe(2);
      expect(tickResult?.skipped).toEqual([{ prNumber: 1, reason: 'merge_conflict' }]);
    }
  });

  it('skips PR when checks are failing', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrSummary({ pullRequestNumber: 1 })];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(makePrDetails({ number: 1 })));
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'failure' }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('skipped_all');
      expect(tickResult?.skipped).toEqual([{ prNumber: 1, reason: 'checks_failing' }]);
    }

    expect(mockGitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
  });

  it('skips PR when checks are pending', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrSummary({ pullRequestNumber: 1 })];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(makePrDetails({ number: 1 })));
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'pending' }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('skipped_all');
      expect(tickResult?.skipped).toEqual([{ prNumber: 1, reason: 'checks_pending' }]);
    }
  });

  it('skips PR when mergeable is null', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrSummary({ pullRequestNumber: 1 })];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(makePrDetails({ number: 1, mergeable: null })));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('skipped_all');
      expect(tickResult?.skipped).toEqual([{ prNumber: 1, reason: 'mergeability_unknown' }]);
    }

    expect(mockGitHubPRClient.getCombinedCheckStatus).not.toHaveBeenCalled();
  });

  it('drains when zero eligible PRs remain', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    // Empty list — no open PRs
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok([]));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('drained');
      expect(tickResult?.remainingPrs).toBe(0);
    }

    expect(mockWatchRepo.update).toHaveBeenCalledWith('watch_abc', expect.objectContaining({
      status: 'drained',
      skippedPrs: [],
    }));
  });

  it('stays active with skipped_all when all eligible PRs have issues', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [
      makePrSummary({ pullRequestNumber: 1, lastActivityAt: new Date('2026-03-14T00:00:00Z') }),
      makePrSummary({ pullRequestNumber: 2, lastActivityAt: new Date('2026-03-16T00:00:00Z') }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    // Both have merge conflicts
    mockGitHubPRClient.getPullRequestDetails
      .mockResolvedValueOnce(ok(makePrDetails({ number: 1, mergeable: false })))
      .mockResolvedValueOnce(ok(makePrDetails({ number: 2, mergeable: false })));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('skipped_all');
      expect(tickResult?.skipped).toHaveLength(2);
      expect(tickResult?.remainingPrs).toBe(2);
    }

    // Should NOT set status to drained
    expect(mockWatchRepo.update).toHaveBeenCalledWith('watch_abc', expect.not.objectContaining({
      status: 'drained',
    }));
  });

  it('returns error when token resolution fails', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(
      err({ code: 'CONNECTION_NOT_FOUND' as const, message: 'No GitHub connection' })
    );

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('error');
    }

    expect(mockWatchRepo.update).toHaveBeenCalledWith('watch_abc', expect.objectContaining({
      lastError: expect.stringContaining('Token resolution failed'),
    }));
  });

  it('skips already-merged PR (405) without adding to mergedPrs', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [
      makePrSummary({ pullRequestNumber: 1, lastActivityAt: new Date('2026-03-14T00:00:00Z') }),
      makePrSummary({ pullRequestNumber: 2, lastActivityAt: new Date('2026-03-16T00:00:00Z') }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    // First PR: already merged (405)
    mockGitHubPRClient.getPullRequestDetails
      .mockResolvedValueOnce(ok(makePrDetails({ number: 1, headSha: 'sha-1' })))
      .mockResolvedValueOnce(ok(makePrDetails({ number: 2, headSha: 'sha-2' })));

    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));

    // First merge returns empty sha (405 already merged)
    mockGitHubPRClient.mergePullRequest
      .mockResolvedValueOnce(ok({ sha: '', merged: true }))
      .mockResolvedValueOnce(ok({ sha: 'merged-sha-2', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('merged');
      expect(tickResult?.mergedPrNumber).toBe(2);
    }

    // appendMergedPr should only be called for PR #2
    expect(mockWatchRepo.appendMergedPr).toHaveBeenCalledTimes(1);
    expect(mockWatchRepo.appendMergedPr).toHaveBeenCalledWith('watch_abc', expect.objectContaining({
      prNumber: 2,
    }));
  });

  it('skips PR on merge conflict at merge time (API_ERROR) and tries next', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [
      makePrSummary({ pullRequestNumber: 1, lastActivityAt: new Date('2026-03-14T00:00:00Z') }),
      makePrSummary({ pullRequestNumber: 2, lastActivityAt: new Date('2026-03-16T00:00:00Z') }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    mockGitHubPRClient.getPullRequestDetails
      .mockResolvedValueOnce(ok(makePrDetails({ number: 1, headSha: 'sha-1' })))
      .mockResolvedValueOnce(ok(makePrDetails({ number: 2, headSha: 'sha-2' })));

    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));

    // First merge fails with API_ERROR (409 conflict)
    mockGitHubPRClient.mergePullRequest
      .mockResolvedValueOnce(err({ code: 'API_ERROR' as const, message: 'Merge conflict' }))
      .mockResolvedValueOnce(ok({ sha: 'merged-sha-2', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('merged');
      expect(tickResult?.mergedPrNumber).toBe(2);
      expect(tickResult?.skipped).toEqual([{ prNumber: 1, reason: 'merge_conflict' }]);
    }
  });

  it('returns error when listing PRs fails', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(
      err({ code: 'API_ERROR' as const, message: 'Rate limited' })
    );

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('error');
    }

    expect(mockWatchRepo.update).toHaveBeenCalledWith('watch_abc', expect.objectContaining({
      lastError: expect.stringContaining('Failed to list PRs'),
    }));
  });

  it('sorts PRs by PR number ASC (oldest first)', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    // PRs returned in arbitrary order — should be sorted by number
    const prs = [
      makePrSummary({ pullRequestNumber: 30 }),
      makePrSummary({ pullRequestNumber: 10 }),
      makePrSummary({ pullRequestNumber: 20 }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(
      ok(makePrDetails({ number: 10, headSha: 'sha-10' }))
    );
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));
    mockGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: 'merged-sha', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      // PR #10 should be merged first (lowest number)
      expect(result.value[0]?.mergedPrNumber).toBe(10);
    }
  });

  it('skips PR when getPullRequestDetails fails', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrSummary({ pullRequestNumber: 1 })];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(
      err({ code: 'API_ERROR' as const, message: 'Not found' })
    );

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('skipped_all');
      expect(tickResult?.skipped).toEqual([{ prNumber: 1, reason: 'checks_pending' }]);
    }
  });

  it('skips PR when getCombinedCheckStatus fails', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrSummary({ pullRequestNumber: 1 })];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(makePrDetails({ number: 1 })));
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(
      err({ code: 'API_ERROR' as const, message: 'Failed' })
    );

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      expect(tickResult?.action).toBe('skipped_all');
      expect(tickResult?.skipped).toEqual([{ prNumber: 1, reason: 'checks_pending' }]);
    }
  });

  it('drains when all eligible PRs are already merged (405)', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrSummary({ pullRequestNumber: 1 })];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(makePrDetails({ number: 1 })));
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));
    // Already merged — sha is empty
    mockGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: '', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      const tickResult = result.value[0];
      // No skipped PRs and no merge → drains
      expect(tickResult?.action).toBe('drained');
    }

    expect(mockWatchRepo.update).toHaveBeenCalledWith('watch_abc', expect.objectContaining({
      status: 'drained',
    }));
  });

  it('clears lastError on successful tick', async () => {
    const watch = makeWatch({
      lastError: 'Previous error',
      lastErrorAt: Timestamp.now(),
    });
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrSummary({ pullRequestNumber: 1 })];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(ok(makePrDetails({ number: 1 })));
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));
    mockGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: 'merged-sha', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value[0]?.action).toBe('merged');
    }

    expect(mockWatchRepo.update).toHaveBeenCalledWith('watch_abc', expect.objectContaining({
      lastError: null,
      lastErrorAt: null,
    }));
  });

  it('skips PRs that are in the watch excludedPrNumbers', async () => {
    const watch = makeWatch({ excludedPrNumbers: [1] });
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [
      makePrSummary({ pullRequestNumber: 1, authorLogin: 'testuser' }),
      makePrSummary({ pullRequestNumber: 2, authorLogin: 'testuser' }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    // Only PR #2 should be processed (PR #1 is excluded)
    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(
      ok(makePrDetails({ number: 2, mergeable: true, headSha: 'sha2' }))
    );
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));
    mockGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: 'merged-sha', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tickResult = result.value[0];
    expect(tickResult).toBeDefined();
    if (tickResult === undefined) return;
    expect(tickResult.action).toBe('merged');
    expect(tickResult.mergedPrNumber).toBe(2);

    // PR #1 should NOT have been fetched for details
    expect(mockGitHubPRClient.getPullRequestDetails).not.toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.anything(), 1
    );
  });

  it('returns skipped_all when all eligible PRs are excluded', async () => {
    const watch = makeWatch({ excludedPrNumbers: [1, 2] });
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [
      makePrSummary({ pullRequestNumber: 1, authorLogin: 'testuser' }),
      makePrSummary({ pullRequestNumber: 2, authorLogin: 'testuser' }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tickResult = result.value[0];
    expect(tickResult).toBeDefined();
    if (tickResult === undefined) return;
    expect(tickResult.action).toBe('skipped_all');
    expect(tickResult.skipped).toStrictEqual([]);
    expect(tickResult.remainingPrs).toBe(2);
    expect(mockGitHubPRClient.getPullRequestDetails).not.toHaveBeenCalled();
  });

  it('handles summaries with null title, authorLogin, baseBranch, and headBranch', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    // Summary with all nullable string fields set to null
    const prs = [
      makePrSummary({
        pullRequestNumber: 99,
        title: null,
        authorLogin: null,
        baseBranch: null,
        headBranch: null,
      }),
    ];
    mockGitHubPRSummaryRepo.findOpenByBaseBranch.mockResolvedValue(ok(prs));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    // PR should be filtered out (authorLogin is null, doesn't match gitHubUsername or allowedBots)
    expect(result.ok).toBe(true);
    if (result.ok === true) {
      expect(result.value[0]?.action).toBe('drained');
    }
  });
});
