import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getGitHubPREvents } from '@/services/codeAgentApi';
import type { GitHubPREvent } from '@/types';

/**
 * Grouped events by pull request number
 */
export interface GroupedPREvents {
  pullRequestNumber: number;
  events: GitHubPREvent[];
  title: string | null;
  repository: string;
}

/**
 * Options for fetching PR events
 */
export interface UseGitHubPREventsOptions {
  limit?: number;
  enabled?: boolean;
}

/**
 * Hook for fetching GitHub PR events.
 * Groups events by pull request number for display.
 */
export function useGitHubPREvents(options?: UseGitHubPREventsOptions): {
  groupedEvents: GroupedPREvents[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [events, setEvents] = useState<GitHubPREvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchEvents = useCallback(
    async (showLoading = true): Promise<void> => {
      const isEnabled = options?.enabled ?? true;
      if (!isAuthenticated || !isEnabled) {
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const requestOptions: { limit?: number } = {};
        if (options?.limit !== undefined) {
          requestOptions.limit = options.limit;
        }
        const data = await getGitHubPREvents(token, requestOptions);
        if (isMountedRef.current) {
          setEvents(data.events);
        }
      } catch (err) {
        if (isMountedRef.current) {
          setError(getErrorMessage(err, 'Failed to load PR events'));
        }
      } finally {
        if (isMountedRef.current) {
          if (showLoading) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [getAccessToken, isAuthenticated, options?.enabled, options?.limit]
  );

  const refresh = useCallback(async (): Promise<void> => {
    await fetchEvents(false);
  }, [fetchEvents]);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchEvents();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [fetchEvents]);

  // Group events by pull request number
  // Filter out PR #0 (push events that aren't PR-specific)
  const prEvents = events.filter((event) => event.pullRequestNumber !== 0);

  const groupedEvents: GroupedPREvents[] = Array.from(
    prEvents.reduce((map, event) => {
      const key = event.pullRequestNumber;
      if (!map.has(key)) {
        map.set(key, {
          pullRequestNumber: key,
          events: [],
          title: event.title,
          repository: event.repository,
        });
      }
      map.get(key)?.events.push(event);
      return map;
    }, new Map<number, GroupedPREvents>()).values()
  ).sort((a, b) => {
    // Sort by most recent event (descending createdAt)
    const aLatest = a.events[0]?.createdAt ?? '';
    const bLatest = b.events[0]?.createdAt ?? '';
    return bLatest.localeCompare(aLatest);
  });

  return {
    groupedEvents,
    loading,
    refreshing,
    error,
    refresh,
  };
}
