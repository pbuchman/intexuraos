import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  archiveBookmark as archiveBookmarkApi,
  createBookmark as createBookmarkApi,
  deleteBookmark as deleteBookmarkApi,
  getBookmark as getBookmarkApi,
  listBookmarks as listBookmarksApi,
  unarchiveBookmark as unarchiveBookmarkApi,
  updateBookmark as updateBookmarkApi,
  type ListBookmarksFilters,
} from '@/services/bookmarksApi';
import type { Bookmark, CreateBookmarkRequest, UpdateBookmarkRequest } from '@/types';

interface UseBookmarksResult {
  bookmarks: Bookmark[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  filters: ListBookmarksFilters;
  setFilters: (filters: ListBookmarksFilters) => void;
  refresh: (showLoading?: boolean) => Promise<void>;
  refreshBookmarkById: (id: string) => Promise<void>;
  createBookmark: (request: CreateBookmarkRequest) => Promise<Bookmark>;
  updateBookmark: (id: string, request: UpdateBookmarkRequest) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  archiveBookmark: (id: string) => Promise<Bookmark>;
  unarchiveBookmark: (id: string) => Promise<Bookmark>;
}

export function useBookmarks(): UseBookmarksResult {
  const { getAccessToken } = useAuth();
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListBookmarksFilters>({});

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
        const data = await listBookmarksApi(token, filters);
        setBookmarks(data);
      } catch (err) {
        setError(getErrorMessage(err, 'Failed to load bookmarks'));
      } finally {
        if (shouldShowLoading) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [getAccessToken, filters]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshBookmarkById = useCallback(
    async (id: string): Promise<void> => {
      try {
        const token = await getAccessToken();
        const updated = await getBookmarkApi(token, id);
        setBookmarks((prev) => {
          const index = prev.findIndex((b) => b.id === id);
          if (index >= 0) {
            const newBookmarks = [...prev];
            newBookmarks[index] = updated;
            return newBookmarks;
          }
          return [updated, ...prev];
        });
      } catch {
        // Silently fail - bookmark may have been deleted or user lost access
      }
    },
    [getAccessToken]
  );

  const createBookmark = useCallback(
    async (request: CreateBookmarkRequest): Promise<Bookmark> => {
      const token = await getAccessToken();
      const newBookmark = await createBookmarkApi(token, request);
      setBookmarks((prev) => [newBookmark, ...prev]);
      return newBookmark;
    },
    [getAccessToken]
  );

  const updateBookmark = useCallback(
    async (id: string, request: UpdateBookmarkRequest): Promise<Bookmark> => {
      const token = await getAccessToken();
      const updated = await updateBookmarkApi(token, id, request);
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      return updated;
    },
    [getAccessToken]
  );

  const deleteBookmark = useCallback(
    async (id: string): Promise<void> => {
      const token = await getAccessToken();
      await deleteBookmarkApi(token, id);
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
    },
    [getAccessToken]
  );

  const archiveBookmark = useCallback(
    async (id: string): Promise<Bookmark> => {
      const token = await getAccessToken();
      const updated = await archiveBookmarkApi(token, id);
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      return updated;
    },
    [getAccessToken]
  );

  const unarchiveBookmark = useCallback(
    async (id: string): Promise<Bookmark> => {
      const token = await getAccessToken();
      const updated = await unarchiveBookmarkApi(token, id);
      setBookmarks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      return updated;
    },
    [getAccessToken]
  );

  return {
    bookmarks,
    loading,
    refreshing,
    error,
    filters,
    setFilters,
    refresh,
    refreshBookmarkById,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    archiveBookmark,
    unarchiveBookmark,
  };
}
