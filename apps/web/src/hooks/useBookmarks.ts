import { useCallback, useEffect, useState } from 'react';
import { getErrorMessage } from '@intexuraos/common-core/errors';
import { useAuth } from '@/context';
import {
  archiveBookmark as archiveBookmarkApi,
  createBookmark as createBookmarkApi,
  deleteBookmark as deleteBookmarkApi,
  listBookmarks as listBookmarksApi,
  unarchiveBookmark as unarchiveBookmarkApi,
  updateBookmark as updateBookmarkApi,
  type ListBookmarksFilters,
} from '@/services/bookmarksApi';
import type { Bookmark, CreateBookmarkRequest, UpdateBookmarkRequest } from '@/types';

interface UseBookmarksResult {
  bookmarks: Bookmark[];
  loading: boolean;
  error: string | null;
  filters: ListBookmarksFilters;
  setFilters: (filters: ListBookmarksFilters) => void;
  refresh: () => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListBookmarksFilters>({});

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      const token = await getAccessToken();
      const data = await listBookmarksApi(token, filters);
      setBookmarks(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load bookmarks'));
    } finally {
      setLoading(false);
    }
  }, [getAccessToken, filters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    error,
    filters,
    setFilters,
    refresh,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    archiveBookmark,
    unarchiveBookmark,
  };
}
