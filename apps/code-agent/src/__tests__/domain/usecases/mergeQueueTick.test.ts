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
import type { GitHubPRClient, GitHubPullRequestListItem, GitHubPullRequestDetails } from '../../../domain/ports/gitHubPRClient.js';
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
    lastError: null,
    lastErrorAt: null,
    createdAt: Timestamp.now(),
    lastTickAt: null,
    drainedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function makePrListItem(overrides: Partial<GitHubPullRequestListItem> = {}): GitHubPullRequestListItem {
  return {
    number: 1,
    title: 'Test PR',
    authorLogin: 'testuser',
    baseBranch: 'main',
    headBranch: 'feature',
    createdAt: '2026-03-14T00:00:00Z',
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
    listOpenPullRequestsByBaseBranch: ReturnType<typeof vi.fn>;
    getPullRequestDetails: ReturnType<typeof vi.fn>;
    getCombinedCheckStatus: ReturnType<typeof vi.fn>;
    mergePullRequest: ReturnType<typeof vi.fn>;
    updatePRTitle: ReturnType<typeof vi.fn>;
    getPullRequestFiles: ReturnType<typeof vi.fn>;
    getPullRequestCommits: ReturnType<typeof vi.fn>;
    getPullRequestBaseBranch: ReturnType<typeof vi.fn>;
    getPullRequestStatus: ReturnType<typeof vi.fn>;
    postPRComment: ReturnType<typeof vi.fn>;
    getIssueComment: ReturnType<typeof vi.fn>;
    updateIssueComment: ReturnType<typeof vi.fn>;
    listAllOpenPullRequests: ReturnType<typeof vi.fn>;
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
      listOpenPullRequestsByBaseBranch: vi.fn(),
      getPullRequestDetails: vi.fn(),
      getCombinedCheckStatus: vi.fn(),
      mergePullRequest: vi.fn(),
      updatePRTitle: vi.fn(),
      getPullRequestFiles: vi.fn(),
      getPullRequestCommits: vi.fn(),
      getPullRequestBaseBranch: vi.fn(),
      getPullRequestStatus: vi.fn(),
      postPRComment: vi.fn(),
      getIssueComment: vi.fn(),
      updateIssueComment: vi.fn(),
      listAllOpenPullRequests: vi.fn(),
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
      gitHubPRClient: mockGitHubPRClient as unknown as GitHubPRClient,
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
      makePrListItem({ number: 10, title: 'PR 10', createdAt: '2026-03-14T00:00:00Z' }),
      makePrListItem({ number: 20, title: 'PR 20', createdAt: '2026-03-16T00:00:00Z' }),
      makePrListItem({ number: 30, title: 'PR 30', createdAt: '2026-03-18T00:00:00Z' }),
    ];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));

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
      makePrListItem({ number: 5, authorLogin: 'dependabot[bot]' }),
    ];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));

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
      makePrListItem({ number: 1, createdAt: '2026-03-14T00:00:00Z' }),
      makePrListItem({ number: 2, createdAt: '2026-03-16T00:00:00Z' }),
    ];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));

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

    const prs = [makePrListItem({ number: 1 })];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));
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

    const prs = [makePrListItem({ number: 1 })];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));
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

    const prs = [makePrListItem({ number: 1 })];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));
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
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok([]));

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
      makePrListItem({ number: 1, createdAt: '2026-03-14T00:00:00Z' }),
      makePrListItem({ number: 2, createdAt: '2026-03-16T00:00:00Z' }),
    ];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));

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
      makePrListItem({ number: 1, createdAt: '2026-03-14T00:00:00Z' }),
      makePrListItem({ number: 2, createdAt: '2026-03-16T00:00:00Z' }),
    ];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));

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
      makePrListItem({ number: 1, createdAt: '2026-03-14T00:00:00Z' }),
      makePrListItem({ number: 2, createdAt: '2026-03-16T00:00:00Z' }),
    ];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));

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
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(
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

  it('sorts PRs by createdAt and uses number as tiebreaker', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    // Two PRs with same createdAt — tiebreak by number
    const prs = [
      makePrListItem({ number: 20, createdAt: '2026-03-14T00:00:00Z' }),
      makePrListItem({ number: 10, createdAt: '2026-03-14T00:00:00Z' }),
    ];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));

    mockGitHubPRClient.getPullRequestDetails.mockResolvedValue(
      ok(makePrDetails({ number: 10, headSha: 'sha-10' }))
    );
    mockGitHubPRClient.getCombinedCheckStatus.mockResolvedValue(ok({ state: 'success' }));
    mockGitHubPRClient.mergePullRequest.mockResolvedValue(ok({ sha: 'merged-sha', merged: true }));

    const tick = createMergeQueueTick(deps);
    const result = await tick();

    expect(result.ok).toBe(true);
    if (result.ok === true) {
      // PR #10 should be merged first (lower number tiebreaker)
      expect(result.value[0]?.mergedPrNumber).toBe(10);
    }
  });

  it('skips PR when getPullRequestDetails fails', async () => {
    const watch = makeWatch();
    mockWatchRepo.findAllActive.mockResolvedValue(ok([watch]));
    mockUserServiceClient.getOAuthToken.mockResolvedValue(ok({ accessToken: 'tok-123', email: 'test@test.com' }));

    const prs = [makePrListItem({ number: 1 })];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));
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

    const prs = [makePrListItem({ number: 1 })];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));
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

    const prs = [makePrListItem({ number: 1 })];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));
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

    const prs = [makePrListItem({ number: 1 })];
    mockGitHubPRClient.listOpenPullRequestsByBaseBranch.mockResolvedValue(ok(prs));
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
});
