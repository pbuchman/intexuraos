/**
 * Tests for useIssueGroups and useRapidPoll hooks,
 * plus the exported mergeGroups utility.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useIssueGroups, useRapidPoll, mergeGroups } from '../useIssueGroups.js';
import type { IssueGroup, ListIssueGroupsResponse, GroupStatus } from '../../types/issueGroups.js';
import type { CodeTask } from '../../types/index.js';

/* ── mocks ─────────────────────────────────────────────────────────── */

const mockGetAccessToken = vi.fn();

vi.mock('../../context/index.js', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

const mockListIssueGroups = vi.fn();

vi.mock('../../services/issueGroupsApi.js', () => ({
  listIssueGroups: (...args: unknown[]): unknown => mockListIssueGroups(...args),
}));

/* ── helpers ───────────────────────────────────────────────────────── */

function makeTask(overrides: Partial<CodeTask> = {}): CodeTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    prompt: 'Fix bug',
    sanitizedPrompt: 'Fix bug',
    systemPromptHash: 'hash-1',
    workerType: 'sonnet',
    workerLocation: 'cloud-run',
    repository: 'test-repo',
    baseBranch: 'development',
    traceId: 'trace-1',
    status: 'running',
    dedupKey: 'dedup-1',
    callbackReceived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<IssueGroup> = {}): IssueGroup {
  const task = makeTask(overrides.latestTask);
  return {
    linearIssueId: 'INT-100',
    linearIssue: undefined,
    tasks: [task],
    pipeline: { steps: [], pr: null, failedAttempts: 0, archivedCount: 0 },
    latestTask: task,
    aggregateStatus: 'active',
    ...overrides,
  };
}

const defaultCounts: Record<GroupStatus, number> = { active: 1, 'needs-action': 0, done: 0, failed: 0 };

function makeResponse(overrides: Partial<ListIssueGroupsResponse> = {}): ListIssueGroupsResponse {
  return {
    groups: [makeGroup()],
    counts: defaultCounts,
    totalGroups: 1,
    ...overrides,
  };
}

/* ── mergeGroups (pure function) ───────────────────────────────────── */

describe('mergeGroups', () => {
  it('returns incoming when prev is empty', () => {
    const incoming = [makeGroup()];
    expect(mergeGroups([], incoming)).toBe(incoming);
  });

  it('preserves reference for unchanged groups', () => {
    const group = makeGroup();
    const prev = [group];
    const incoming = [makeGroup()]; // same aggregateStatus & updatedAt

    const result = mergeGroups(prev, incoming);
    expect(result[0]).toBe(group); // reference preserved
  });

  it('returns prev array when nothing changed', () => {
    const group = makeGroup();
    const prev = [group];
    const incoming = [makeGroup()]; // identical

    const result = mergeGroups(prev, incoming);
    expect(result).toBe(prev);
  });

  it('replaces groups that changed aggregateStatus', () => {
    const prev = [makeGroup({ aggregateStatus: 'active' })];
    const updated = makeGroup({ aggregateStatus: 'done' });
    const incoming = [updated];

    const result = mergeGroups(prev, incoming);
    expect(result[0]).toBe(updated);
    expect(result).not.toBe(prev);
  });

  it('replaces groups that changed updatedAt', () => {
    const prev = [makeGroup({ latestTask: makeTask({ updatedAt: '2026-01-01T00:00:00Z' }) })];
    const updated = makeGroup({ latestTask: makeTask({ updatedAt: '2026-01-02T00:00:00Z' }) });
    const incoming = [updated];

    const result = mergeGroups(prev, incoming);
    expect(result[0]).toBe(updated);
  });

  it('detects length change', () => {
    const prev = [makeGroup()];
    const g1 = makeGroup({ linearIssueId: 'INT-100' });
    const g2 = makeGroup({ linearIssueId: 'INT-200', latestTask: makeTask({ id: 'task-2' }) });
    const incoming = [g1, g2];

    const result = mergeGroups(prev, incoming);
    expect(result).toHaveLength(2);
    expect(result).not.toBe(prev);
  });

  it('uses latestTask.id as key when linearIssueId is null', () => {
    const prev = [makeGroup({ linearIssueId: null, latestTask: makeTask({ id: 'task-A' }) })];
    const incoming = [makeGroup({ linearIssueId: null, latestTask: makeTask({ id: 'task-A' }) })];

    const result = mergeGroups(prev, incoming);
    // Same key, same status/updatedAt → reference preserved
    expect(result[0]).toBe(prev[0]);
  });
});

/* ── useIssueGroups ────────────────────────────────────────────────── */

describe('useIssueGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetAccessToken.mockResolvedValue('test-token');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches groups on mount', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useIssueGroups({}));
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockListIssueGroups).toHaveBeenCalledWith('test-token', { limit: 20 });
    expect(result.current.groups).toHaveLength(1);
    expect(result.current.counts).toEqual(defaultCounts);
    expect(result.current.totalGroups).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it('passes groupStatus and sortBy to API', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse({ groups: [] }));

    const { result } = renderHook(() =>
      useIssueGroups({ groupStatus: ['active', 'failed'], sortBy: 'pr-number' }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockListIssueGroups).toHaveBeenCalledWith('test-token', {
      groupStatus: ['active', 'failed'],
      sortBy: 'pr-number',
      limit: 20,
    });
  });

  it('handles fetch error', async () => {
    mockListIssueGroups.mockRejectedValue(new Error('Network failure'));

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network failure');
    expect(result.current.groups).toEqual([]);
  });

  it('sets hasMore when nextCursor is present', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse({ nextCursor: 'cursor-abc' }));

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
  });

  it('sets hasMore false when no nextCursor', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.hasMore).toBe(false);
  });

  it('loads more groups and appends them', async () => {
    const group1 = makeGroup({ linearIssueId: 'INT-100' });
    mockListIssueGroups.mockResolvedValue(makeResponse({ groups: [group1], nextCursor: 'cursor-1' }));

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const group2 = makeGroup({ linearIssueId: 'INT-200', latestTask: makeTask({ id: 'task-2' }) });
    mockListIssueGroups.mockResolvedValue(makeResponse({ groups: [group2] }));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.groups).toHaveLength(2);
    expect(mockListIssueGroups).toHaveBeenLastCalledWith('test-token', {
      limit: 20,
      cursor: 'cursor-1',
    });
  });

  it('does not loadMore when hasMore is false', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callCount = mockListIssueGroups.mock.calls.length;

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockListIssueGroups).toHaveBeenCalledTimes(callCount);
  });

  it('handles loadMore error', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse({ nextCursor: 'cursor-1' }));

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockListIssueGroups.mockRejectedValue(new Error('Load more failed'));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe('Load more failed');
    expect(result.current.loadingMore).toBe(false);
  });

  it('refresh without showLoading sets refreshing', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse());

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockListIssueGroups.mockResolvedValue(makeResponse());

    // Refresh without showing loading spinner
    await act(async () => {
      await result.current.refresh(false);
    });

    expect(result.current.loading).toBe(false);
  });

  it('polls when active count > 0', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse({ counts: { ...defaultCounts, active: 3 } }));

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callsBefore = mockListIssueGroups.mock.calls.length;

    // Advance past poll interval
    await act(async () => {
      vi.advanceTimersByTime(30001);
    });

    expect(mockListIssueGroups.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('does not poll when active count is 0', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse({ counts: { ...defaultCounts, active: 0 } }));

    const { result } = renderHook(() => useIssueGroups({}));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const callsAfterLoad = mockListIssueGroups.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(mockListIssueGroups).toHaveBeenCalledTimes(callsAfterLoad);
  });

  it('re-fetches when filter options change', async () => {
    mockListIssueGroups.mockResolvedValue(makeResponse());

    const { result, rerender } = renderHook(
      (props: { groupStatus?: GroupStatus[] }) => useIssueGroups(props),
      { initialProps: {} },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    mockListIssueGroups.mockResolvedValue(makeResponse({ groups: [] }));

    rerender({ groupStatus: ['failed'] });

    await waitFor(() => {
      expect(mockListIssueGroups).toHaveBeenCalledWith('test-token', {
        groupStatus: ['failed'],
        limit: 20,
      });
    });
  });
});

/* ── useRapidPoll ──────────────────────────────────────────────────── */

describe('useRapidPoll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not poll when actioningTaskId is null', () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);

    renderHook(() => useRapidPoll(null, [], mockRefresh, null));

    vi.advanceTimersByTime(10000);

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('polls rapidly when actioningTaskId is set', () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const groups = [makeGroup({ aggregateStatus: 'failed', latestTask: makeTask({ id: 'task-action' }) })];

    renderHook(() => useRapidPoll('task-action', groups, mockRefresh, 'retry'));

    vi.advanceTimersByTime(3001);

    expect(mockRefresh).toHaveBeenCalledWith(false);
  });

  it('stops rapid polling after 30s', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const groups = [makeGroup({ aggregateStatus: 'failed', latestTask: makeTask({ id: 'task-x' }) })];

    const { result } = renderHook(() => useRapidPoll('task-x', groups, mockRefresh, 'retry'));

    await act(async () => {
      vi.advanceTimersByTime(30001);
    });

    expect(result.current.actioningTaskId).toBeNull();
  });

  it('clears actioning state when group transitions out of failed/needs-action for retry', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const groups = [makeGroup({ aggregateStatus: 'active', latestTask: makeTask({ id: 'task-y' }) })];

    const { result } = renderHook(() => useRapidPoll('task-y', groups, mockRefresh, 'retry'));

    // Group is 'active' (not failed/needs-action), so actioning should clear
    await waitFor(() => {
      expect(result.current.actioningTaskId).toBeNull();
    });
  });

  it('does NOT clear actioning state for archive on non-failed group', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const groups = [makeGroup({ aggregateStatus: 'done', latestTask: makeTask({ id: 'task-archive' }) })];

    const { result } = renderHook(() => useRapidPoll('task-archive', groups, mockRefresh, 'archive'));

    // Give effects time to run
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Archive action should NOT be cleared despite group being 'done'
    expect(result.current.actioningTaskId).toBe('task-archive');
  });

  it('does NOT clear actioning state for delete on non-failed group', async () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    const groups = [makeGroup({ aggregateStatus: 'active', latestTask: makeTask({ id: 'task-delete' }) })];

    const { result } = renderHook(() => useRapidPoll('task-delete', groups, mockRefresh, 'delete'));

    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // Delete action should NOT be cleared despite group being 'active'
    expect(result.current.actioningTaskId).toBe('task-delete');
  });

  it('exposes setActioningTaskId', () => {
    const mockRefresh = vi.fn().mockResolvedValue(undefined);
    // Provide a group with failed status so the effect doesn't immediately clear
    const groups = [makeGroup({ aggregateStatus: 'failed', latestTask: makeTask({ id: 'task-new' }) })];

    const { result } = renderHook(() => useRapidPoll(null, groups, mockRefresh, null));

    act(() => {
      result.current.setActioningTaskId('task-new');
    });

    expect(result.current.actioningTaskId).toBe('task-new');
  });
});
