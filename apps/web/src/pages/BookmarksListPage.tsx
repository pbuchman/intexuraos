import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, Bookmark, Plus } from 'lucide-react';
import { Button, Card, ErrorBanner, Layout } from '@/components';
import { useAuth } from '@/context';
import { useBookmarkChanges, useBookmarks } from '@/hooks';
import { getBookmark as getBookmarkApi, type ListBookmarksFilters } from '@/services/bookmarksApi';
import type { Bookmark as BookmarkType } from '@/types';
import { BookmarkModal } from '@/components/bookmarks/BookmarkModal.js';
import { BookmarkRow } from '@/components/bookmarks/BookmarkRow.js';
import { BOOKMARK_SORT_OPTIONS, BOOKMARKS_SORT_KEY, type BookmarkSortOption } from '@/components/bookmarks/shared.js';
import { CreateBookmarkModal } from '@/components/bookmarks/CreateBookmarkModal.js';
import { FilterBar } from '@/components/bookmarks/FilterBar.js';

// 💰 CostGuard: Debounce delay for batch fetching changed bookmarks
const DEBOUNCE_DELAY_MS = 500;

function getLocalStorageSort(): BookmarkSortOption {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(BOOKMARKS_SORT_KEY);
    if (stored === 'title' || stored === 'updated' || stored === 'created') {
      return stored;
    }
  }
  return 'created';
}

export function BookmarksListPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const {
    bookmarks,
    loading,
    error,
    filters,
    setFilters,
    refreshBookmarkById,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    archiveBookmark,
    unarchiveBookmark,
  } = useBookmarks();
  const [selectedBookmark, setSelectedBookmark] = useState<BookmarkType | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [sort, setSort] = useState<BookmarkSortOption>(getLocalStorageSort);

  // 💰 CostGuard: Real-time bookmark listener for enrichment updates
  const { changedBookmarkIds, clearChangedIds } = useBookmarkChanges();
  const debounceTimeoutRef = useRef<number | null>(null);

  // 💰 CostGuard: Debounced effect for fetching changed bookmarks
  useEffect(() => {
    if (changedBookmarkIds.length === 0) return;

    if (debounceTimeoutRef.current !== null) {
      window.clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = window.setTimeout(() => {
      // Fetch each changed bookmark (typically just one at a time for enrichment)
      for (const id of changedBookmarkIds) {
        void refreshBookmarkById(id);
      }
      clearChangedIds();
    }, DEBOUNCE_DELAY_MS);

    return (): void => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [changedBookmarkIds, refreshBookmarkById, clearChangedIds]);

  useEffect(() => {
    const bookmarkId = searchParams.get('id');
    if (bookmarkId !== null && bookmarks.length > 0) {
      const bookmark = bookmarks.find((b) => b.id === bookmarkId);
      if (bookmark !== undefined) {
        setSelectedBookmark(bookmark);
        setSearchParams({}, { replace: true });
      }
    }
  }, [bookmarks, searchParams, setSearchParams]);

  const handleSortChange = useCallback((newSort: BookmarkSortOption): void => {
    setSort(newSort);
    localStorage.setItem(BOOKMARKS_SORT_KEY, newSort);
  }, []);

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    bookmarks.forEach((b) => {
      b.tags.forEach((t) => {
        tagSet.add(t);
      });
    });
    return Array.from(tagSet).sort();
  }, [bookmarks]);

  const filteredAndSortedBookmarks = useMemo(() => {
    const result = [...bookmarks];

    // Sort
    result.sort((a, b) => {
      if (sort === 'title') {
        const titleA = a.title ?? a.ogPreview?.title ?? a.url;
        const titleB = b.title ?? b.ogPreview?.title ?? b.url;
        return titleA.localeCompare(titleB);
      }
      if (sort === 'updated') {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      // Default: created
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [bookmarks, sort]);

  const archivedCount = useMemo(() => {
    return bookmarks.filter((b) => b.archived).length;
  }, [bookmarks]);

  const handleTagClick = useCallback(
    (tag: string): void => {
      const newFilters: ListBookmarksFilters = { tags: [tag] };
      if (filters.archived !== undefined) {
        newFilters.archived = filters.archived;
      }
      if (filters.ogFetchStatus !== undefined) {
        newFilters.ogFetchStatus = filters.ogFetchStatus;
      }
      setFilters(newFilters);
    },
    [filters, setFilters]
  );

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">My Bookmarks</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {bookmarks.length} bookmarks · {archivedCount} archived
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={(): void => {
            setShowCreateModal(true);
          }}
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Bookmark</span>
        </Button>
      </div>

      <FilterBar filters={filters} onFiltersChange={setFilters} availableTags={availableTags} />

      <div className="mb-4 flex items-center gap-2">
        <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
        <div className="flex gap-1.5">
          {BOOKMARK_SORT_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={(): void => {
                handleSortChange(key);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                sort === key
                  ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <ErrorBanner message={error} className="mb-6" />

      {filteredAndSortedBookmarks.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bookmark className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-100">No bookmarks yet</h3>
            <p className="mb-4 text-slate-500 dark:text-slate-400">Save your first bookmark to get started.</p>
            <Button
              type="button"
              variant="primary"
              onClick={(): void => {
                setShowCreateModal(true);
              }}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Bookmark</span>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-1">
          {filteredAndSortedBookmarks.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              onOpen={(): void => {
                setSelectedBookmark(bookmark);
              }}
              onDelete={async (): Promise<void> => {
                await deleteBookmark(bookmark.id);
              }}
              onTagClick={handleTagClick}
            />
          ))}
        </div>
      )}

      {selectedBookmark !== null ? (
        <BookmarkModal
          bookmark={selectedBookmark}
          onClose={(): void => {
            setSelectedBookmark(null);
          }}
          onUpdate={async (request): Promise<void> => {
            const updated = await updateBookmark(selectedBookmark.id, request);
            setSelectedBookmark(updated);
          }}
          onDelete={async (): Promise<void> => {
            await deleteBookmark(selectedBookmark.id);
          }}
          onArchive={async (): Promise<void> => {
            const updated = await archiveBookmark(selectedBookmark.id);
            setSelectedBookmark(updated);
          }}
          onUnarchive={async (): Promise<void> => {
            const updated = await unarchiveBookmark(selectedBookmark.id);
            setSelectedBookmark(updated);
          }}
        />
      ) : null}

      {showCreateModal ? (
        <CreateBookmarkModal
          onClose={(): void => {
            setShowCreateModal(false);
          }}
          onCreate={async (url, title, description, tags): Promise<void> => {
            const request: Parameters<typeof createBookmark>[0] = {
              url,
              tags,
              source: 'web',
              sourceId: `web-${String(Date.now())}`,
            };
            if (title !== null) {
              request.title = title;
            }
            if (description !== null) {
              request.description = description;
            }
            await createBookmark(request);
          }}
          onViewExisting={(bookmarkId): void => {
            setShowCreateModal(false);
            const existingBookmark = bookmarks.find((b) => b.id === bookmarkId);
            if (existingBookmark !== undefined) {
              setSelectedBookmark(existingBookmark);
            } else {
              void (async (): Promise<void> => {
                const token = await getAccessToken();
                const bookmark = await getBookmarkApi(token, bookmarkId);
                setSelectedBookmark(bookmark);
              })();
            }
          }}
        />
      ) : null}
    </Layout>
  );
}
