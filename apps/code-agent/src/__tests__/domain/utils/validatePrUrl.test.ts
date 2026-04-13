/**
 * Tests for validatePrUrl domain utility (INT-1361).
 */

import { describe, it, expect, vi } from 'vitest';
import { ok, err } from '@intexuraos/common-core';
import { validatePrUrl, type PrUrlValidationParams } from '../../../domain/utils/validatePrUrl.js';
import type { GitHubPRClient, GitHubPullRequestDetails, GitHubPRClientError } from '../../../domain/ports/gitHubPRClient.js';
import type { Logger } from '@intexuraos/common-core';
import type { Result } from '@intexuraos/common-core';

function createFakeLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createFakeGitHubPRClient(
  getPullRequestDetailsResult: Result<GitHubPullRequestDetails, GitHubPRClientError>
): GitHubPRClient {
  return {
    getPullRequestDetails: vi.fn().mockResolvedValue(getPullRequestDetailsResult),
    updatePRTitle: vi.fn(),
    getPullRequestFiles: vi.fn(),
    getPullRequestCommits: vi.fn(),
    getPullRequestBaseBranch: vi.fn(),
    getPullRequestStatus: vi.fn(),
    postPRComment: vi.fn(),
    listOpenPullRequestsByBaseBranch: vi.fn(),
    mergePullRequest: vi.fn(),
    getCombinedCheckStatus: vi.fn(),
    listAllOpenPullRequests: vi.fn(),
    getIssueComment: vi.fn(),
    updateIssueComment: vi.fn(),
  } as unknown as GitHubPRClient;
}

function createBaseParams(overrides: Partial<PrUrlValidationParams> = {}): PrUrlValidationParams {
  const defaultPrDetails: GitHubPullRequestDetails = {
    number: 901,
    title: '[INT-123] My feature',
    body: null,
    state: 'open',
    authorLogin: 'test-user',
    baseBranch: 'development',
    headBranch: 'feature/int-123',
    mergeable: null,
    mergeableState: null,
    headSha: 'abc123',
    createdAt: '2026-04-14T00:00:00Z',
  };

  return {
    prUrl: 'https://github.com/pbuchman/intexuraos/pull/901',
    prNumber: 901,
    linearIssueId: 'INT-123',
    dispatchedAt: new Date('2026-04-13T00:00:00Z'),
    token: 'ghp_test',
    owner: 'pbuchman',
    repo: 'intexuraos',
    gitHubPRClient: createFakeGitHubPRClient(ok(defaultPrDetails)),
    logger: createFakeLogger(),
    ...overrides,
  };
}

describe('validatePrUrl', () => {
  it('returns no errors when PR exists, title contains Linear issue ID, and createdAt is after dispatchedAt', async () => {
    const params = createBaseParams();

    const result = await validatePrUrl(params);

    expect(result.failed).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('returns error when PR does not exist (NOT_FOUND)', async () => {
    const params = createBaseParams({
      gitHubPRClient: createFakeGitHubPRClient(
        err({ code: 'NOT_FOUND', message: 'Not found' })
      ),
    });

    const result = await validatePrUrl(params);

    expect(result.failed).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does not exist');
    expect(result.errors[0]).toContain('901');
  });

  it('returns error when PR title does not contain Linear issue ID', async () => {
    const params = createBaseParams({
      gitHubPRClient: createFakeGitHubPRClient(ok({
        number: 901,
        title: '[INT-999] Wrong PR',
        body: null,
        state: 'open',
        authorLogin: 'test-user',
        baseBranch: 'development',
        headBranch: 'feature/int-999',
        mergeable: null,
        mergeableState: null,
        headSha: 'abc123',
        createdAt: '2026-04-14T00:00:00Z',
      })),
    });

    const result = await validatePrUrl(params);

    expect(result.failed).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does not contain expected Linear issue ID');
    expect(result.errors[0]).toContain('INT-123');
  });

  it('returns error when PR was created before task dispatch', async () => {
    const params = createBaseParams({
      dispatchedAt: new Date('2026-04-15T00:00:00Z'),
      gitHubPRClient: createFakeGitHubPRClient(ok({
        number: 901,
        title: '[INT-123] My feature',
        body: null,
        state: 'open',
        authorLogin: 'test-user',
        baseBranch: 'development',
        headBranch: 'feature/int-123',
        mergeable: null,
        mergeableState: null,
        headSha: 'abc123',
        createdAt: '2026-04-14T00:00:00Z',
      })),
    });

    const result = await validatePrUrl(params);

    expect(result.failed).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('before task was dispatched');
  });

  it('returns multiple errors when multiple checks fail', async () => {
    const params = createBaseParams({
      dispatchedAt: new Date('2026-04-15T00:00:00Z'),
      gitHubPRClient: createFakeGitHubPRClient(ok({
        number: 901,
        title: '[INT-999] Wrong PR',
        body: null,
        state: 'open',
        authorLogin: 'test-user',
        baseBranch: 'development',
        headBranch: 'feature/int-999',
        mergeable: null,
        mergeableState: null,
        headSha: 'abc123',
        createdAt: '2026-04-14T00:00:00Z',
      })),
    });

    const result = await validatePrUrl(params);

    expect(result.failed).toBe(true);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('does not contain expected Linear issue ID');
    expect(result.errors[1]).toContain('before task was dispatched');
  });

  it('returns no errors and failed: false when GitHub API returns non-NOT_FOUND error (graceful degradation)', async () => {
    const params = createBaseParams({
      gitHubPRClient: createFakeGitHubPRClient(
        err({ code: 'RATE_LIMITED', message: 'Rate limited' })
      ),
    });

    const result = await validatePrUrl(params);

    expect(result.failed).toBe(false);
    expect(result.errors).toEqual([]);
    expect(params.logger.warn).toHaveBeenCalled();
  });

  it('skips recency check when dispatchedAt is undefined', async () => {
    const client = createFakeGitHubPRClient(ok({
      number: 901,
      title: '[INT-123] My feature',
      body: null,
      state: 'open',
      authorLogin: 'test-user',
      baseBranch: 'development',
      headBranch: 'feature/int-123',
      mergeable: null,
      mergeableState: null,
      headSha: 'abc123',
      createdAt: '2020-01-01T00:00:00Z', // very old, but no dispatchedAt to compare
    }));
    // Omit dispatchedAt entirely to test the undefined path
    const params: PrUrlValidationParams = {
      prUrl: 'https://github.com/pbuchman/intexuraos/pull/901',
      prNumber: 901,
      linearIssueId: 'INT-123',
      token: 'ghp_test',
      owner: 'pbuchman',
      repo: 'intexuraos',
      gitHubPRClient: client,
      logger: createFakeLogger(),
    };

    const result = await validatePrUrl(params);

    expect(result.failed).toBe(false);
    expect(result.errors).toEqual([]);
  });
});
