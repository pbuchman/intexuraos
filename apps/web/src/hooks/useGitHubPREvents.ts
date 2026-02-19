import { useCallback, useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import { getGitHubPREvents } from '@/services/codeAgentApi';
import type { GitHubPREvent } from '@/types';

/**
 * Options for fetching PR events for a specific pull request.
 * Enabled defaults to false — events are loaded lazily when the row is expanded.
 */
export interface UseGitHubPREventsOptions {
  repository: string;
  pullRequestNumber: number;
  enabled?: boolean;
}

/**
 * Hook for fetching events for a single pull request.
 * Returns events oldest-first (API reverses the stored desc order).
 */
export function useGitHubPREvents(options: UseGitHubPREventsOptions): {
  events: GitHubPREvent[];
  loading: boolean;
  error: string | null;
} {
  const { getAccessToken, isAuthenticated } = useAuth();
  const [events, setEvents] = useState<GitHubPREvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const { repository, pullRequestNumber, enabled = false } = options;

  const fetchEvents = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || !enabled) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await getGitHubPREvents(token, {
        repository,
        pullRequestNumber,
        limit: 200,
      });
      if (isMountedRef.current) {
        setEvents(data.events);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(getErrorMessage(err, 'Failed to load PR events'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [getAccessToken, isAuthenticated, repository, pullRequestNumber, enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    void fetchEvents();
    return (): void => {
      isMountedRef.current = false;
    };
  }, [fetchEvents]);

  return { events, loading, error };
}
