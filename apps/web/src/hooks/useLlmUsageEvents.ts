import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listLlmUsageEvents } from '@/services/llmUsageApi';
import type { UsageEvent, UsageEventFilters, UsageEventSortField, ListLlmUsageEventsRequest } from '@/types';
import type { ResolvedTimeRange } from '@/utils/llmUsageTimeRange.js';

const DEFAULT_LIMIT = 50;
const POLL_INTERVAL_MS = 30000;

export interface UseLlmUsageEventsOptions {
  timeRange: ResolvedTimeRange;
  filters: UsageEventFilters;
  sortBy: { field: UsageEventSortField; direction: 'asc' | 'desc' };
  /** When false, the hook skips all API calls and returns empty initial state. Defaults to true. */
  enabled?: boolean;
}

export interface UseLlmUsageEventsResult {
  events: UsageEvent[];
  totalMatched: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
}

const NOOP_ASYNC = (): Promise<void> => Promise.resolve();

const DISABLED_RESULT: UseLlmUsageEventsResult = {
  events: [],
  totalMatched: 0,
  loading: false,
  loadingMore: false,
  error: null,
  hasMore: false,
  loadMore: NOOP_ASYNC,
  refresh: NOOP_ASYNC,
};

export function useLlmUsageEvents(options: UseLlmUsageEventsOptions): UseLlmUsageEventsResult {
  const enabled = options.enabled !== false;
  const { getAccessToken } = useAuth();
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const isMountedRef = useRef(true);
  const isInitialLoadRef = useRef(true);
  const optionsJsonRef = useRef('');

  const refresh = useCallback(
    async (silent?: boolean): Promise<void> => {
      if (silent !== true) {
        setLoading(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const response = await listLlmUsageEvents(token, {
          timeRange: options.timeRange,
          filters: options.filters,
          sortBy: options.sortBy,
          limit: DEFAULT_LIMIT,
        });

        if (isMountedRef.current) {
          setEvents(response.events);
          setTotalMatched(response.totalMatched);
          setNextCursor(response.nextCursor);
          setHasMore(response.nextCursor !== undefined);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load usage events'));
        }
      } finally {
        if (isMountedRef.current && silent !== true) {
          setLoading(false);
        }
      }
    },
    [getAccessToken, options.timeRange, options.filters, options.sortBy],
  );

  // Stable serialized options for change detection
  const optionsJson = JSON.stringify({
    timeRange: options.timeRange,
    filters: options.filters,
    sortBy: options.sortBy,
  });

  // Initial load + options-change refresh
  useEffect(() => {
    if (!enabled) return;
    if (optionsJson === optionsJsonRef.current) return;
    optionsJsonRef.current = optionsJson;
    isMountedRef.current = true;
    void refresh();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [enabled, optionsJson, refresh]);

  // Tab visibility refresh
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && !isInitialLoadRef.current) {
        void refresh(true);
      }
      isInitialLoadRef.current = false;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, refresh]);

  // Polling: 30s interval when document is visible
  useEffect(() => {
    if (!enabled) return;

    const pollId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh(true);
      }
    }, POLL_INTERVAL_MS);
    return (): void => {
      clearInterval(pollId);
    };
  }, [enabled, refresh]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading || loadingMore) return;

    setLoadingMore(true);
    try {
      const token = await getAccessToken();
      const request: ListLlmUsageEventsRequest = {
        timeRange: options.timeRange,
        filters: options.filters,
        sortBy: options.sortBy,
        limit: DEFAULT_LIMIT,
      };
      if (nextCursor !== undefined) {
        request.cursor = nextCursor;
      }
      const response = await listLlmUsageEvents(token, request);

      if (isMountedRef.current) {
        setEvents((prev) => [...prev, ...response.events]);
        setTotalMatched(response.totalMatched);
        setNextCursor(response.nextCursor);
        setHasMore(response.nextCursor !== undefined);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to load more events'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [hasMore, loading, loadingMore, getAccessToken, options.timeRange, options.filters, options.sortBy, nextCursor]);

  // Public refresh always shows loading
  const publicRefresh = useCallback(async (): Promise<void> => {
    await refresh();
  }, [refresh]);

  if (!enabled) {
    return DISABLED_RESULT;
  }

  return {
    events,
    totalMatched,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh: publicRefresh,
  };
}
