/**
 * Hook for managing issue groups with server-side grouping and pagination.
 * Replaces client-side grouping from useCodeTasks + groupByLinearIssue.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { listIssueGroups as listIssueGroupsApi } from '@/services/issueGroupsApi';
import type { GroupStatus, IssueGroup, ListIssueGroupsResponse, SortOption } from '@/types/issueGroups';
import type { ActioningType } from '@/types/issueGroups';

const DEFAULT_LIMIT = 20;
const MAX_SINGLE_REQUEST_LIMIT = 100;
const POLL_INTERVAL_MS = 30000;
const RAPID_POLL_INTERVAL_MS = 3000;
const RAPID_POLL_DURATION_MS = 30000;

/**
 * Build API options object, omitting undefined values to satisfy
 * exactOptionalPropertyTypes.
 */
function buildApiOptions(
  groupStatus: GroupStatus[] | undefined, // @allow-undefined-type -- function parameter, not optional property
  sortBy: SortOption | undefined, // @allow-undefined-type -- function parameter, not optional property
  limit: number,
  cursor?: string,
): { groupStatus?: GroupStatus[]; sortBy?: SortOption; limit: number; cursor?: string } {
  const result: { groupStatus?: GroupStatus[]; sortBy?: SortOption; limit: number; cursor?: string } = {
    limit,
  };
  if (groupStatus !== undefined) {
    result.groupStatus = groupStatus;
  }
  if (sortBy !== undefined) {
    result.sortBy = sortBy;
  }
  if (cursor !== undefined) {
    result.cursor = cursor;
  }
  return result;
}

/**
 * Merge incoming groups with previous state, preserving object references
 * for groups that haven't changed. Prevents unnecessary re-renders in
 * downstream memoized components.
 */
export function mergeGroups(prev: IssueGroup[], incoming: IssueGroup[]): IssueGroup[] {
  if (prev.length === 0) return incoming;
  const prevMap = new Map(prev.map((g) => [g.linearIssueId ?? g.latestTask.id, g]));
  let changed = prev.length !== incoming.length;
  const merged = incoming.map((g) => {
    const key = g.linearIssueId ?? g.latestTask.id;
    const existing = prevMap.get(key);
    if (existing?.aggregateStatus === g.aggregateStatus && existing.latestTask.updatedAt === g.latestTask.updatedAt) {
      return existing;
    }
    changed = true;
    return g;
  });
  return changed ? merged : prev;
}

export interface UseIssueGroupsResult {
  groups: IssueGroup[];
  counts: Record<GroupStatus, number>;
  totalGroups: number;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: (showLoading?: boolean) => Promise<void>;
}

export function useIssueGroups(options: {
  groupStatus?: GroupStatus[];
  sortBy?: SortOption;
}): UseIssueGroupsResult {
  const { getAccessToken } = useAuth();
  const [groups, setGroups] = useState<IssueGroup[]>([]);
  const [counts, setCounts] = useState<Record<GroupStatus, number>>({
    active: 0,
    'needs-action': 0,
    done: 0,
    failed: 0,
  });
  const [totalGroups, setTotalGroups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const isMountedRef = useRef(true);
  const isInitialLoadRef = useRef(true);
  const isInitialMountRef = useRef(true);
  const loadedGroupCountRef = useRef(0);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const shouldShowLoading = showLoading !== false;

      if (shouldShowLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const loaded = loadedGroupCountRef.current;

        let allGroups: IssueGroup[] = [];
        let response: ListIssueGroupsResponse;

        if (loaded <= MAX_SINGLE_REQUEST_LIMIT) {
          // Single request with expanded limit
          const fetchLimit = Math.max(loaded, DEFAULT_LIMIT);
          response = await listIssueGroupsApi(token, buildApiOptions(
            options.groupStatus,
            options.sortBy,
            fetchLimit,
          ));
          allGroups = response.groups;
        } else {
          // Multi-request refill for large loaded counts
          let cursor: string | undefined; // @allow-undefined-type -- local variable initial value
          let lastResponse: ListIssueGroupsResponse | undefined; // @allow-undefined-type -- local variable initial value
          while (allGroups.length < loaded) {
            const batchResponse = await listIssueGroupsApi(token, buildApiOptions(
              options.groupStatus,
              options.sortBy,
              MAX_SINGLE_REQUEST_LIMIT,
              cursor,
            ));
            lastResponse = batchResponse;
            allGroups.push(...batchResponse.groups);
            cursor = batchResponse.nextCursor;
            if (cursor === undefined) break;
          }
          // Use counts/totalGroups from the last response
          response = lastResponse ?? {
            groups: [],
            counts: { active: 0, 'needs-action': 0, done: 0, failed: 0 },
            totalGroups: 0,
          };
        }

        if (isMountedRef.current) {
          setGroups((prev) => mergeGroups(prev, allGroups));
          setCounts(response.counts);
          setTotalGroups(response.totalGroups);
          loadedGroupCountRef.current = allGroups.length;

          // Determine cursor for next page
          if (allGroups.length <= MAX_SINGLE_REQUEST_LIMIT) {
            setNextCursor(response.nextCursor);
            setHasMore(response.nextCursor !== undefined);
          } else {
            // For multi-request refill, compute cursor from loaded count
            // The server will interpret this as the start index
            const lastBatchCursor = response.nextCursor;
            setNextCursor(lastBatchCursor);
            setHasMore(lastBatchCursor !== undefined);
          }
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load issue groups'));
        }
      } finally {
        if (isMountedRef.current) {
          if (shouldShowLoading) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [getAccessToken, options.groupStatus, options.sortBy]
  );

  // Initial load + parameter-change refresh
  useEffect(() => {
    isMountedRef.current = true;
    const isInitial = isInitialMountRef.current;
    isInitialMountRef.current = false;
    // Initial mount → spinner (showLoading=true); parameter changes → progress bar (showLoading=false)
    void refresh(isInitial);
    return (): void => {
      isMountedRef.current = false;
    };
  }, [refresh]);

  // Tab visibility refresh
  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible' && !isInitialLoadRef.current) {
        void refresh(false);
      }
      isInitialLoadRef.current = false;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return (): void => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  // Polling: 30s interval when active groups exist
  useEffect(() => {
    if (counts.active <= 0) return;

    const pollId = setInterval(() => { void refresh(false); }, POLL_INTERVAL_MS);
    return (): void => { clearInterval(pollId); };
  }, [counts.active, refresh]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading || loadingMore) return;

    setLoadingMore(true);
    try {
      const token = await getAccessToken();
      const response = await listIssueGroupsApi(token, buildApiOptions(
        options.groupStatus,
        options.sortBy,
        DEFAULT_LIMIT,
        nextCursor,
      ));

      if (isMountedRef.current) {
        setGroups((prev) => {
          const merged = [...prev, ...response.groups];
          loadedGroupCountRef.current = merged.length;
          return merged;
        });
        setCounts(response.counts);
        setTotalGroups(response.totalGroups);
        setNextCursor(response.nextCursor);
        setHasMore(response.nextCursor !== undefined);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to load more groups'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoadingMore(false);
      }
    }
  }, [hasMore, loading, loadingMore, getAccessToken, options.groupStatus, options.sortBy, nextCursor]);

  return {
    groups,
    counts,
    totalGroups,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}

/**
 * Hook for rapid polling after user actions (implement, retry, archive, delete).
 * Polls every 3s for 30s, then stops.
 */
export function useRapidPoll(
  actioningTaskId: string | null,
  groups: IssueGroup[],
  refresh: (showLoading?: boolean) => Promise<void>,
  actioningType: ActioningType,
): {
  actioningTaskId: string | null;
  setActioningTaskId: (id: string | null) => void;
} {
  const [currentActioningId, setActioningTaskId] = useState<string | null>(actioningTaskId);
  const rapidPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return (): void => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (currentActioningId === null) return;
    const pollId = setInterval(() => { refresh(false).catch(() => undefined); }, RAPID_POLL_INTERVAL_MS);
    rapidPollTimeoutRef.current = setTimeout(() => {
      rapidPollTimeoutRef.current = null;
      if (isMountedRef.current) {
        setActioningTaskId(null);
      }
    }, RAPID_POLL_DURATION_MS);
    return (): void => {
      clearInterval(pollId);
      if (rapidPollTimeoutRef.current !== null) {
        clearTimeout(rapidPollTimeoutRef.current);
        rapidPollTimeoutRef.current = null;
      }
    };
  }, [currentActioningId, refresh]);

  // Clear actioning state when the group transitions out of failed/needs-action.
  // Skip for archive/delete — those groups may be in any status and will be
  // removed from the list entirely once refresh returns updated data.
  useEffect(() => {
    if (currentActioningId === null) return;
    if (actioningType === 'archive' || actioningType === 'delete') return;
    const group = groups.find(
      (g) => g.latestTask.id === currentActioningId || g.tasks.some((t) => t.id === currentActioningId),
    );
    if (group === undefined || (group.aggregateStatus !== 'failed' && group.aggregateStatus !== 'needs-action')) {
      setActioningTaskId(null);
    }
  }, [currentActioningId, groups, actioningType]);

  return { actioningTaskId: currentActioningId, setActioningTaskId };
}
