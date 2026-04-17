/**
 * Tests for useDigestList hook.
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { PersistedDailySummary } from '@/types/notificationDigests';

const { mockGetAccessToken, mockListDigests } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(),
  mockListDigests: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: (): { getAccessToken: typeof mockGetAccessToken } => ({
    getAccessToken: mockGetAccessToken,
  }),
}));

vi.mock('@/services/notificationDigestsApi', () => ({
  listDigests: mockListDigests,
}));

vi.mock('@intexuraos/common-core/errors', () => ({
  getErrorMessage: (err: unknown, defaultMsg: string): string => {
    if (err instanceof Error) return err.message;
    return defaultMsg;
  },
}));

import {
  DIGEST_LIST_FILTER_STORAGE_KEY,
  DIGEST_LIST_SORT_STORAGE_KEY,
  loadDigestFilterFromStorage,
  loadDigestSortFromStorage,
  useDigestList,
} from '../useDigestList.js';

function summary(date: string, generation: number, messageCount: number): PersistedDailySummary {
  return {
    summary: {
      date, groupKey: 'g', messageCount, narrative: '',
      threads: [], moderatorPosts: [], openQuestions: [], activityOutliers: [],
    },
    generation,
    generatedAt: `${date}T12:00:00Z`,
    modelId: 'test-model',
  };
}

describe('useDigestList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetAccessToken.mockResolvedValue('tok');
  });

  it('loads digests on mount and applies default date range', async () => {
    const items = [summary('2026-04-15', 1, 42), summary('2026-04-14', 2, 10)];
    mockListDigests.mockResolvedValue({ items });

    const { result } = renderHook(() => useDigestList({ groupKey: 'g' }));

    expect(result.current.loading).toBe(true);
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.current.toDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mockListDigests).toHaveBeenCalledWith('tok', expect.objectContaining({ groupKey: 'g' }));
  });

  it('handles API errors', async () => {
    mockListDigests.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useDigestList({ groupKey: 'g' }));
    await waitFor(() => { expect(result.current.loading).toBe(false); });
    expect(result.current.error).toBe('boom');
    expect(result.current.items).toEqual([]);
  });

  it('filters to regenerated only when filter="regenerated"', async () => {
    const items = [summary('2026-04-15', 1, 1), summary('2026-04-14', 3, 5)];
    mockListDigests.mockResolvedValue({ items });
    const { result } = renderHook(() => useDigestList({ groupKey: 'g' }));
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    act(() => { result.current.setFilter('regenerated'); });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.generation).toBe(3);
  });

  it('persists filter and sort in localStorage', async () => {
    mockListDigests.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useDigestList({ groupKey: 'g' }));
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    act(() => { result.current.setFilter('single-generation'); });
    act(() => { result.current.setSort('date-asc'); });

    expect(localStorage.getItem(DIGEST_LIST_FILTER_STORAGE_KEY)).toBe('single-generation');
    expect(localStorage.getItem(DIGEST_LIST_SORT_STORAGE_KEY)).toBe('date-asc');
  });

  it('sorts by messageCount desc when requested', async () => {
    const items = [summary('2026-04-14', 1, 10), summary('2026-04-15', 1, 50), summary('2026-04-13', 1, 30)];
    mockListDigests.mockResolvedValue({ items });
    const { result } = renderHook(() => useDigestList({ groupKey: 'g' }));
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    act(() => { result.current.setSort('message-count-desc'); });
    expect(result.current.items.map((i) => i.summary.messageCount)).toEqual([50, 30, 10]);
  });

  it('uses explicit fromDate/toDate when provided', async () => {
    mockListDigests.mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useDigestList({ groupKey: 'g', fromDate: '2026-01-01', toDate: '2026-01-10' }));
    await waitFor(() => { expect(result.current.loading).toBe(false); });

    expect(result.current.fromDate).toBe('2026-01-01');
    expect(result.current.toDate).toBe('2026-01-10');
    expect(mockListDigests).toHaveBeenCalledWith('tok', { groupKey: 'g', fromDate: '2026-01-01', toDate: '2026-01-10' });
  });
});

describe('loadDigestFilterFromStorage', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns "all" when nothing stored', () => {
    expect(loadDigestFilterFromStorage()).toBe('all');
  });

  it('returns stored valid value', () => {
    localStorage.setItem(DIGEST_LIST_FILTER_STORAGE_KEY, 'regenerated');
    expect(loadDigestFilterFromStorage()).toBe('regenerated');
  });

  it('falls back on garbage', () => {
    localStorage.setItem(DIGEST_LIST_FILTER_STORAGE_KEY, 'garbage');
    expect(loadDigestFilterFromStorage()).toBe('all');
  });
});

describe('loadDigestSortFromStorage', () => {
  beforeEach(() => { localStorage.clear(); });

  it('returns "date-desc" when nothing stored', () => {
    expect(loadDigestSortFromStorage()).toBe('date-desc');
  });

  it('returns stored valid value', () => {
    localStorage.setItem(DIGEST_LIST_SORT_STORAGE_KEY, 'message-count-desc');
    expect(loadDigestSortFromStorage()).toBe('message-count-desc');
  });

  it('falls back on garbage', () => {
    localStorage.setItem(DIGEST_LIST_SORT_STORAGE_KEY, 'garbage');
    expect(loadDigestSortFromStorage()).toBe('date-desc');
  });
});
