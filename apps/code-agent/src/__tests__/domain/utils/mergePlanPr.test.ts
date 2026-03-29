import { describe, it, expect, vi } from 'vitest';
import { mergePlanPr, type MergePlanPrDeps } from '../../../domain/utils/mergePlanPr.js';
import { ok, err } from '@intexuraos/common-core';

function createFakeDeps(overrides?: Partial<MergePlanPrDeps>): MergePlanPrDeps {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as unknown as MergePlanPrDeps['logger'],
    gitHubPRClient: {
      mergePullRequest: vi.fn().mockResolvedValue(ok({ sha: 'abc123', merged: true })),
      getPullRequestStatus: vi.fn().mockResolvedValue(ok({ state: 'open', mergedAt: null, headRef: 'plan/test' })),
    } as unknown as MergePlanPrDeps['gitHubPRClient'],
    ...overrides,
  };
}

describe('mergePlanPr', () => {
  it('merges an open plan PR and returns success', async () => {
    const deps = createFakeDeps();

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(true);
    expect(deps.gitHubPRClient.mergePullRequest).toHaveBeenCalledWith(
      'ghp_test',
      'pbuchman',
      'intexuraos',
      1509,
      'merge',
      expect.any(String),
    );
  });

  it('returns success when plan PR is already merged', async () => {
    const deps = createFakeDeps({
      gitHubPRClient: {
        getPullRequestStatus: vi.fn().mockResolvedValue(ok({
          state: 'closed', mergedAt: new Date(), headRef: 'plan/test',
        })),
        mergePullRequest: vi.fn(),
      } as unknown as MergePlanPrDeps['gitHubPRClient'],
    });

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(true);
    expect(deps.gitHubPRClient.mergePullRequest).not.toHaveBeenCalled();
  });

  it('returns error when plan PR is closed without merge', async () => {
    const deps = createFakeDeps({
      gitHubPRClient: {
        getPullRequestStatus: vi.fn().mockResolvedValue(ok({
          state: 'closed', mergedAt: null, headRef: 'plan/test',
        })),
        mergePullRequest: vi.fn(),
      } as unknown as MergePlanPrDeps['gitHubPRClient'],
    });

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('plan_pr_merge_failed');
      expect(result.error.message).toContain('closed without merging');
    }
  });

  it('returns error when plan PR has merge conflicts', async () => {
    const deps = createFakeDeps({
      gitHubPRClient: {
        getPullRequestStatus: vi.fn().mockResolvedValue(ok({
          state: 'open', mergedAt: null, headRef: 'plan/test',
        })),
        mergePullRequest: vi.fn().mockResolvedValue(err({
          code: 'API_ERROR',
          message: 'Merge conflict',
        })),
      } as unknown as MergePlanPrDeps['gitHubPRClient'],
    });

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('plan_pr_merge_failed');
      expect(result.error.message).toContain('Merge conflict');
    }
  });

  it('returns error when plan PR is not found', async () => {
    const deps = createFakeDeps({
      gitHubPRClient: {
        getPullRequestStatus: vi.fn().mockResolvedValue(err({
          code: 'NOT_FOUND',
          message: 'Not Found',
        })),
        mergePullRequest: vi.fn(),
      } as unknown as MergePlanPrDeps['gitHubPRClient'],
    });

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/9999',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('plan_pr_merge_failed');
      expect(result.error.message).toContain('not found');
    }
  });

  it('returns error for unparseable PR URL', async () => {
    const deps = createFakeDeps();

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://example.com/not-a-pr',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('plan_pr_merge_failed');
      expect(result.error.message).toContain('Could not parse PR number');
    }
  });

  it('returns error for invalid repository format', async () => {
    const deps = createFakeDeps();

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
      repository: 'invalid-repo',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('plan_pr_merge_failed');
      expect(result.error.message).toContain('Invalid repository format');
    }
  });

  it('returns error when getPullRequestStatus returns a non-NOT_FOUND error', async () => {
    const deps = createFakeDeps({
      gitHubPRClient: {
        getPullRequestStatus: vi.fn().mockResolvedValue(err({
          code: 'API_ERROR',
          message: 'Server error',
        })),
        mergePullRequest: vi.fn(),
      } as unknown as MergePlanPrDeps['gitHubPRClient'],
    });

    const result = await mergePlanPr(deps, {
      planningPrUrl: 'https://github.com/pbuchman/intexuraos/pull/1509',
      repository: 'pbuchman/intexuraos',
      token: 'ghp_test',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('plan_pr_merge_failed');
      expect(result.error.message).toContain('Failed to check plan PR');
    }
  });
});
