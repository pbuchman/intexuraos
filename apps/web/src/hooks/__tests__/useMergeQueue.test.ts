/** @vitest-environment jsdom */

/**
 * Tests for useMergeQueue hook.
 */

import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMergeQueue } from '../useMergeQueue.js';

const mockGetAccessToken = vi.fn();
const mockListBranches = vi.fn();
const mockListPrs = vi.fn();
const mockListWatches = vi.fn();
const mockCreateWatch = vi.fn();
const mockCancelWatch = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('../../services/mergeQueueApi.js', () => ({
  listBranches: (...args: unknown[]): unknown => mockListBranches(...args),
  listPrs: (...args: unknown[]): unknown => mockListPrs(...args),
  listWatches: (...args: unknown[]): unknown => mockListWatches(...args),
  createWatch: (...args: unknown[]): unknown => mockCreateWatch(...args),
  cancelWatch: (...args: unknown[]): unknown => mockCancelWatch(...args),
}));

const OWNER = 'test-owner';
const REPO = 'test-repo';

function makeBranch(name: string, openPrCount: number): { name: string; openPrCount: number } {
  return { name, openPrCount };
}

function makePr(number: number, title: string): {
  number: number;
  title: string;
  author: string;
  authorIsEligible: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  checksStatus: 'success' | 'failure' | 'pending';
  createdAt: string;
  htmlUrl: string;
} {
  return {
    number,
    title,
    author: 'dev',
    authorIsEligible: true,
    mergeable: true,
    mergeableState: 'clean',
    checksStatus: 'success',
    createdAt: '2026-03-20T00:00:00Z',
    htmlUrl: `https://github.com/${OWNER}/${REPO}/pull/${String(number)}`,
  };
}

function makeWatch(
  watchId: string,
  baseBranch: string,
  status: 'active' | 'drained' | 'cancelled' = 'active',
): {
  watchId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  status: 'active' | 'drained' | 'cancelled';
  mergedPrs: [];
  skippedPrs: [];
  lastError: string | null;
  lastErrorAt: string | null;
  createdAt: string;
  lastTickAt: string | null;
  drainedAt: string | null;
} {
  return {
    watchId,
    owner: OWNER,
    repo: REPO,
    baseBranch,
    status,
    mergedPrs: [],
    skippedPrs: [],
    lastError: null,
    lastErrorAt: null,
    createdAt: '2026-03-20T00:00:00Z',
    lastTickAt: null,
    drainedAt: null,
  };
}

describe('useMergeQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue('test-token');
    mockListBranches.mockResolvedValue({ branches: [] });
    mockListPrs.mockResolvedValue({ pullRequests: [] });
    mockListWatches.mockResolvedValue({ watches: [] });
    mockCreateWatch.mockResolvedValue({});
    mockCancelWatch.mockResolvedValue({});
  });

  it('fetches branches and watches on mount and auto-selects branch with highest PR count', async () => {
    const branchA = makeBranch('feature-a', 2);
    const branchB = makeBranch('main', 5);
    const branchC = makeBranch('develop', 3);
    const watch1 = makeWatch('w-1', 'main');

    mockListBranches.mockResolvedValue({ branches: [branchA, branchB, branchC] });
    mockListWatches.mockResolvedValue({ watches: [watch1] });
    mockListPrs.mockResolvedValue({ pullRequests: [makePr(1, 'PR 1')] });

    const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockListBranches).toHaveBeenCalledWith('test-token', OWNER, REPO);
    expect(mockListWatches).toHaveBeenCalledWith('test-token', OWNER, REPO);
    expect(result.current.branches).toEqual([branchA, branchB, branchC]);
    expect(result.current.watches).toEqual([watch1]);
    expect(result.current.selectedBranch).toBe('main');
    expect(result.current.error).toBeNull();
  });

  it('fetches PRs when selectedBranch is set', async () => {
    const branch = makeBranch('main', 2);
    const pr1 = makePr(10, 'Fix bug');
    const pr2 = makePr(11, 'Add feature');

    mockListBranches.mockResolvedValue({ branches: [branch] });
    mockListWatches.mockResolvedValue({ watches: [] });
    mockListPrs.mockResolvedValue({ pullRequests: [pr1, pr2] });

    const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // selectedBranch auto-selected to 'main', which triggers PR fetch
    await waitFor(() => {
      expect(result.current.prsLoading).toBe(false);
    });

    expect(mockListPrs).toHaveBeenCalledWith('test-token', OWNER, REPO, 'main');
    expect(result.current.prs).toEqual([pr1, pr2]);
    expect(result.current.prsError).toBeNull();
  });

  it('creates watch when no active watch exists and refetches watches', async () => {
    const branch = makeBranch('main', 1);
    mockListBranches.mockResolvedValue({ branches: [branch] });
    mockListWatches.mockResolvedValue({ watches: [] });
    mockListPrs.mockResolvedValue({ pullRequests: [] });

    const newWatch = makeWatch('w-new', 'main');
    mockCreateWatch.mockResolvedValue({});

    const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Setup: after toggle, listWatches returns the new watch
    mockListWatches.mockResolvedValue({ watches: [newWatch] });

    act(() => {
      result.current.handleToggleWatch();
    });

    await waitFor(() => {
      expect(result.current.isToggling).toBe(false);
    });

    expect(mockCreateWatch).toHaveBeenCalledWith('test-token', OWNER, REPO, 'main');
    expect(mockCancelWatch).not.toHaveBeenCalled();
    // Refetched watches after toggle
    expect(result.current.watches).toEqual([newWatch]);
    expect(result.current.toggleError).toBeNull();
  });

  it('cancels watch when active watch exists and refetches watches', async () => {
    const branch = makeBranch('main', 1);
    const activeWatch = makeWatch('w-active', 'main', 'active');

    mockListBranches.mockResolvedValue({ branches: [branch] });
    mockListWatches.mockResolvedValue({ watches: [activeWatch] });
    mockListPrs.mockResolvedValue({ pullRequests: [] });

    const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // After cancel, listWatches returns empty
    mockListWatches.mockResolvedValue({ watches: [] });

    act(() => {
      result.current.handleToggleWatch();
    });

    await waitFor(() => {
      expect(result.current.isToggling).toBe(false);
    });

    expect(mockCancelWatch).toHaveBeenCalledWith('test-token', 'w-active');
    expect(mockCreateWatch).not.toHaveBeenCalled();
    expect(result.current.watches).toEqual([]);
    expect(result.current.toggleError).toBeNull();
  });

  it('surfaces toggleError when toggle fails', async () => {
    const branch = makeBranch('main', 1);
    mockListBranches.mockResolvedValue({ branches: [branch] });
    mockListWatches.mockResolvedValue({ watches: [] });
    mockListPrs.mockResolvedValue({ pullRequests: [] });

    const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockCreateWatch.mockRejectedValue(new Error('Toggle failed'));

    act(() => {
      result.current.handleToggleWatch();
    });

    await waitFor(() => {
      expect(result.current.isToggling).toBe(false);
    });

    expect(result.current.toggleError).toBe('Toggle failed');
  });

  it('sets error state on initial fetch failure', async () => {
    mockListBranches.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.branches).toEqual([]);
  });

  it('prevents stale branch PR state corruption when selectedBranch changes before fetchPrs resolves', async () => {
    const branchMain = makeBranch('main', 3);
    const branchDev = makeBranch('develop', 1);
    const stalePr = makePr(99, 'Stale PR from main');
    const freshPr = makePr(50, 'Fresh PR from develop');

    mockListBranches.mockResolvedValue({ branches: [branchMain, branchDev] });
    mockListWatches.mockResolvedValue({ watches: [] });

    // First listPrs call (for auto-selected 'main') will be slow
    let resolveSlowFetch: ((value: { pullRequests: typeof stalePr[] }) => void) | undefined;
    const slowPromise = new Promise<{ pullRequests: typeof stalePr[] }>((resolve) => {
      resolveSlowFetch = resolve;
    });

    mockListPrs.mockImplementationOnce(() => slowPromise);

    const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

    // Wait for initial data to load (branches/watches)
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // selectedBranch is 'main' (highest PR count), and fetchPrs is in flight
    expect(result.current.selectedBranch).toBe('main');

    // Now change the branch to 'develop' before the slow fetch resolves
    mockListPrs.mockResolvedValue({ pullRequests: [freshPr] });

    act(() => {
      result.current.setSelectedBranch('develop');
    });

    // Wait for the develop PRs to load
    await waitFor(() => {
      expect(result.current.prs).toEqual([freshPr]);
    });

    // Now resolve the stale 'main' fetch - it should NOT overwrite 'develop' PRs
    resolveSlowFetch?.({ pullRequests: [stalePr] });

    // Give React a tick to process
    await waitFor(() => {
      expect(result.current.prsLoading).toBe(false);
    });

    // PRs should still be the 'develop' PRs, not the stale 'main' ones
    expect(result.current.selectedBranch).toBe('develop');
    expect(result.current.prs).toEqual([freshPr]);
  });
});
