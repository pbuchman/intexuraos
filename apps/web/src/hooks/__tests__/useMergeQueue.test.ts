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
const mockUpdateExclusions = vi.fn();

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
  updateExclusions: (...args: unknown[]): unknown => mockUpdateExclusions(...args),
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
  excludedPrNumbers: number[] = [],
): {
  watchId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  status: 'active' | 'drained' | 'cancelled';
  mergedPrs: [];
  skippedPrs: [];
  excludedPrNumbers: number[];
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
    excludedPrNumbers,
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
    mockUpdateExclusions.mockResolvedValue({ excludedPrNumbers: [] });
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

    expect(mockCreateWatch).toHaveBeenCalledWith('test-token', OWNER, REPO, 'main', []);
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

  describe('exclusion management', () => {
    it('syncs excludedPrNumbers from active watch data', async () => {
      const branch = makeBranch('main', 1);
      const watch = makeWatch('w-1', 'main', 'active', [42, 99]);

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [watch] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([42, 99]));
    });

    it('toggles exclusion optimistically and calls updateExclusions', async () => {
      const branch = makeBranch('main', 1);
      const watch = makeWatch('w-1', 'main', 'active');

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [watch] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });
      mockUpdateExclusions.mockResolvedValue({ excludedPrNumbers: [42] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Toggle PR #42 to excluded
      act(() => {
        result.current.handleToggleExclusion(42);
      });

      // Optimistic update — immediate
      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));

      await waitFor(() => {
        expect(mockUpdateExclusions).toHaveBeenCalledWith('test-token', 'w-1', [42]);
      });

      // Toggle again to re-include
      act(() => {
        result.current.handleToggleExclusion(42);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set());

      await waitFor(() => {
        expect(mockUpdateExclusions).toHaveBeenCalledWith('test-token', 'w-1', []);
      });

      expect(mockUpdateExclusions).toHaveBeenCalledTimes(2);
    });

    it('reverts exclusion and shows error on API failure', async () => {
      const branch = makeBranch('main', 1);
      const watch = makeWatch('w-1', 'main', 'active');

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [watch] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });
      mockUpdateExclusions.mockRejectedValue(new Error('API failed'));

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.handleToggleExclusion(42);
      });

      // Optimistic
      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));

      // Wait for revert
      await waitFor(() => {
        expect(result.current.excludedPrNumbers).toEqual(new Set());
      });

      expect(result.current.exclusionError).toBe('API failed');
    });

    it('auto-clears exclusion error after 3 seconds', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      try {
        const branch = makeBranch('main', 1);
        const watch = makeWatch('w-1', 'main', 'active');

        mockListBranches.mockResolvedValue({ branches: [branch] });
        mockListWatches.mockResolvedValue({ watches: [watch] });
        mockListPrs.mockResolvedValue({ pullRequests: [] });
        mockUpdateExclusions.mockRejectedValue(new Error('API failed'));

        const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });

        act(() => {
          result.current.handleToggleExclusion(42);
        });

        // Wait for API failure to set the error
        await waitFor(() => {
          expect(result.current.exclusionError).toBe('API failed');
        });

        // Advance past the 3s error clear timer
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3001);
        });

        expect(result.current.exclusionError).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('handleSelectAll clears all exclusions and calls API', async () => {
      const branch = makeBranch('main', 1);
      const watch = makeWatch('w-1', 'main', 'active', [10, 20]);

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [watch] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });
      mockUpdateExclusions.mockResolvedValue({ excludedPrNumbers: [] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Verify initial sync
      expect(result.current.excludedPrNumbers).toEqual(new Set([10, 20]));

      act(() => {
        result.current.handleSelectAll();
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set());

      await waitFor(() => {
        expect(mockUpdateExclusions).toHaveBeenCalledWith('test-token', 'w-1', []);
      });
    });

    it('handleDeselectAll excludes all eligible PRs and calls API', async () => {
      const branch = makeBranch('main', 1);
      const watch = makeWatch('w-1', 'main', 'active');

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [watch] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });
      mockUpdateExclusions.mockResolvedValue({ excludedPrNumbers: [1, 2, 3] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.handleDeselectAll([1, 2, 3]);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([1, 2, 3]));

      await waitFor(() => {
        expect(mockUpdateExclusions).toHaveBeenCalledWith('test-token', 'w-1', [1, 2, 3]);
      });
    });

    it('does not call API when toggling with no active watch (pre-watch state)', async () => {
      const branch = makeBranch('main', 1);

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.handleToggleExclusion(42);
      });

      // State updates in memory only
      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));
      expect(mockUpdateExclusions).not.toHaveBeenCalled();
    });

    it('blocks concurrent exclusion updates while API call is in-flight', async () => {
      const branch = makeBranch('main', 1);
      const watch = makeWatch('w-1', 'main', 'active');

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [watch] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      // First API call hangs until resolved
      let resolveFirst: (() => void) | undefined;
      mockUpdateExclusions.mockImplementationOnce(
        () => new Promise<{ excludedPrNumbers: number[] }>((resolve) => {
          resolveFirst = (): void => { resolve({ excludedPrNumbers: [42] }); };
        })
      );

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // First toggle — starts in-flight API call
      act(() => {
        result.current.handleToggleExclusion(42);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));

      // Wait for the first API call to be initiated (async getAccessToken microtask resolves)
      await waitFor(() => {
        expect(mockUpdateExclusions).toHaveBeenCalledTimes(1);
      });

      // Second toggle while first is still in-flight — should be blocked
      act(() => {
        result.current.handleToggleExclusion(99);
      });

      // State should still be {42} — the second toggle was blocked
      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));
      expect(mockUpdateExclusions).toHaveBeenCalledTimes(1);

      // Resolve first call to clean up
      resolveFirst?.();

      await waitFor(() => {
        expect(mockUpdateExclusions).toHaveBeenCalledTimes(1);
      });
    });

    it('preserves pre-watch exclusions across watch poll cycles', async () => {
      const branch = makeBranch('main', 1);

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set pre-watch exclusions
      act(() => {
        result.current.handleToggleExclusion(42);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));

      // Simulate a watch poll returning empty watches (new array reference)
      mockListWatches.mockResolvedValue({ watches: [] });

      // Trigger a re-render by updating watches state (simulates poll)
      await act(async () => {
        // Force a watches update by calling fetchInitialData which re-fetches
        await result.current.fetchInitialData();
      });

      // Pre-watch exclusions should be preserved, NOT cleared by the poll
      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));
    });

    it('does not call API for handleSelectAll with no active watch', async () => {
      const branch = makeBranch('main', 1);

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set some pre-watch exclusions first
      act(() => {
        result.current.handleToggleExclusion(10);
      });
      act(() => {
        result.current.handleToggleExclusion(20);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([10, 20]));

      // Select all — should clear exclusions locally but not call API
      act(() => {
        result.current.handleSelectAll();
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set());
      expect(mockUpdateExclusions).not.toHaveBeenCalled();
    });

    it('does not call API for handleDeselectAll with no active watch', async () => {
      const branch = makeBranch('main', 1);

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Deselect all — should set exclusions locally but not call API
      act(() => {
        result.current.handleDeselectAll([1, 2, 3]);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([1, 2, 3]));
      expect(mockUpdateExclusions).not.toHaveBeenCalled();
    });

    it('clears exclusions when selectedBranch changes', async () => {
      const branchA = makeBranch('main', 2);
      const branchB = makeBranch('develop', 1);

      mockListBranches.mockResolvedValue({ branches: [branchA, branchB] });
      mockListWatches.mockResolvedValue({ watches: [] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Auto-selected 'main' (highest PR count). Set some exclusions.
      expect(result.current.selectedBranch).toBe('main');

      act(() => {
        result.current.handleToggleExclusion(42);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));

      // Switch branch — exclusions should reset
      act(() => {
        result.current.setSelectedBranch('develop');
      });

      await waitFor(() => {
        expect(result.current.excludedPrNumbers).toEqual(new Set());
      });
    });

    it('sends excludedPrNumbers when creating a watch', async () => {
      const branch = makeBranch('main', 1);

      mockListBranches.mockResolvedValue({ branches: [branch] });
      mockListWatches.mockResolvedValue({ watches: [] });
      mockListPrs.mockResolvedValue({ pullRequests: [] });

      const newWatch = makeWatch('w-new', 'main', 'active', [42]);
      mockCreateWatch.mockResolvedValue(newWatch);

      const { result } = renderHook(() => useMergeQueue(OWNER, REPO));

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Set up pre-watch exclusions
      act(() => {
        result.current.handleToggleExclusion(42);
      });

      expect(result.current.excludedPrNumbers).toEqual(new Set([42]));

      // Create watch
      mockListWatches.mockResolvedValue({ watches: [newWatch] });

      act(() => {
        result.current.handleToggleWatch();
      });

      await waitFor(() => {
        expect(result.current.isToggling).toBe(false);
      });

      expect(mockCreateWatch).toHaveBeenCalledWith('test-token', OWNER, REPO, 'main', [42]);
    });
  });
});
