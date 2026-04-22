import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { listDigests } from '@/services/notificationDigestsApi';
import { currentMonthIso, firstDayOfMonth, lastDayOfMonth } from '@/utils/digestDates.js';
import type { PersistedDailySummary } from '@/types/notificationDigests';

export type DigestStatusFilter = 'all' | 'regenerated' | 'single-generation';
export type DigestSortOption = 'date-desc' | 'date-asc' | 'message-count-desc';

export const DIGEST_LIST_FILTER_STORAGE_KEY = 'notification-digests-filter';
export const DIGEST_LIST_SORT_STORAGE_KEY = 'notification-digests-sort';

export interface UseDigestListOptions {
  readonly groupKey: string;
  /** `YYYY-MM`. Defaults to the current month. */
  readonly month?: string;
}

export interface UseDigestListResult {
  readonly items: readonly PersistedDailySummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly filter: DigestStatusFilter;
  readonly sort: DigestSortOption;
  readonly fromDate: string;
  readonly toDate: string;
  readonly setFilter: (filter: DigestStatusFilter) => void;
  readonly setSort: (sort: DigestSortOption) => void;
  readonly refresh: () => Promise<void>;
}

export function isDigestStatusFilter(value: unknown): value is DigestStatusFilter {
  return value === 'all' || value === 'regenerated' || value === 'single-generation';
}

export function isDigestSortOption(value: unknown): value is DigestSortOption {
  return value === 'date-desc' || value === 'date-asc' || value === 'message-count-desc';
}

export function loadDigestFilterFromStorage(): DigestStatusFilter {
  const stored = localStorage.getItem(DIGEST_LIST_FILTER_STORAGE_KEY);
  return isDigestStatusFilter(stored) ? stored : 'all';
}

export function loadDigestSortFromStorage(): DigestSortOption {
  const stored = localStorage.getItem(DIGEST_LIST_SORT_STORAGE_KEY);
  return isDigestSortOption(stored) ? stored : 'date-desc';
}

function applyFilter(
  items: readonly PersistedDailySummary[],
  filter: DigestStatusFilter,
): readonly PersistedDailySummary[] {
  if (filter === 'all') return items;
  if (filter === 'regenerated') return items.filter((d) => d.generation > 1);
  return items.filter((d) => d.generation === 1);
}

function applySort(
  items: readonly PersistedDailySummary[],
  sort: DigestSortOption,
): readonly PersistedDailySummary[] {
  const copy = [...items];
  if (sort === 'date-desc') return copy.sort((a, b) => b.summary.date.localeCompare(a.summary.date));
  if (sort === 'date-asc') return copy.sort((a, b) => a.summary.date.localeCompare(b.summary.date));
  return copy.sort((a, b) => b.summary.messageCount - a.summary.messageCount);
}

export function useDigestList(options: UseDigestListOptions): UseDigestListResult {
  const { getAccessToken } = useAuth();
  const month = options.month ?? currentMonthIso();
  const fromDate = firstDayOfMonth(month);
  const toDate = lastDayOfMonth(month);
  const [raw, setRaw] = useState<readonly PersistedDailySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilterState] = useState<DigestStatusFilter>(loadDigestFilterFromStorage);
  const [sort, setSortState] = useState<DigestSortOption>(loadDigestSortFromStorage);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const resp = await listDigests(token, {
        groupKey: options.groupKey,
        fromDate,
        toDate,
      });
      setRaw(resp.items);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Nie udało się pobrać podsumowań'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, options.groupKey, fromDate, toDate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setFilter = useCallback((next: DigestStatusFilter): void => {
    setFilterState(next);
    localStorage.setItem(DIGEST_LIST_FILTER_STORAGE_KEY, next);
  }, []);

  const setSort = useCallback((next: DigestSortOption): void => {
    setSortState(next);
    localStorage.setItem(DIGEST_LIST_SORT_STORAGE_KEY, next);
  }, []);

  const items = useMemo(
    () => applySort(applyFilter(raw, filter), sort),
    [raw, filter, sort],
  );

  return { items, loading, error, filter, sort, fromDate, toDate, setFilter, setSort, refresh };
}
