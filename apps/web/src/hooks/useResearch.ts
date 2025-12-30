import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@/context';
import {
  createResearch as createResearchApi,
  listResearches as listResearchesApi,
  getResearch as getResearchApi,
  deleteResearch as deleteResearchApi,
} from '@/services/llmOrchestratorApi';
import type { Research, CreateResearchRequest } from '@/services/llmOrchestratorApi.types';

/**
 * Hook for fetching a single research by ID with auto-polling during processing.
 */
export function useResearch(id: string): {
  research: Research | null;
  loading: boolean;
  error: string | null;
  refresh: (showLoading?: boolean) => Promise<void>;
} {
  const { getAccessToken } = useAuth();
  const [research, setResearch] = useState<Research | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (showLoading?: boolean): Promise<void> => {
      const shouldShowLoading = showLoading !== false;

      if (id === '') {
        setLoading(false);
        return;
      }

      if (shouldShowLoading) {
        setLoading(true);
      }
      setError(null);

      try {
        const token = await getAccessToken();
        const data = await getResearchApi(token, id);
        setResearch(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load research');
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        }
      }
    },
    [id, getAccessToken]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll for updates while processing (without showing loading state)
  useEffect(() => {
    if (research?.status === 'pending' || research?.status === 'processing') {
      const interval = setInterval(() => {
        void refresh(false);
      }, 3000);
      return (): void => {
        clearInterval(interval);
      };
    }
    return undefined;
  }, [research?.status, refresh]);

  return { research, loading, error, refresh };
}

/**
 * Hook for managing a list of researches with pagination.
 */
export function useResearches(): {
  researches: Research[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  deleteResearch: (id: string) => Promise<void>;
  createResearch: (request: CreateResearchRequest) => Promise<Research>;
} {
  const { getAccessToken } = useAuth();
  const [researches, setResearches] = useState<Research[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listResearchesApi(token);
      setResearches(data.items);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load researches');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!hasMore || loading) return;

    try {
      const token = await getAccessToken();
      const data = await listResearchesApi(token, cursor);
      setResearches((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setHasMore(data.nextCursor !== undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load more');
    }
  }, [cursor, hasMore, loading, getAccessToken]);

  const deleteResearch = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteResearchApi(token, id);
      setResearches((prev) => prev.filter((r) => r.id !== id));
    },
    [getAccessToken]
  );

  const createResearch = useCallback(
    async (request: CreateResearchRequest): Promise<Research> => {
      const token = await getAccessToken();
      const newResearch = await createResearchApi(token, request);
      setResearches((prev) => [newResearch, ...prev]);
      return newResearch;
    },
    [getAccessToken]
  );

  return {
    researches,
    loading,
    error,
    hasMore,
    loadMore,
    refresh,
    deleteResearch,
    createResearch,
  };
}
