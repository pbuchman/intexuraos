import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowUpDown, Bell, RefreshCw } from 'lucide-react';
import { Button, Card, ErrorBanner, Layout } from '@/components';
import { useAuth } from '@/context';
import {
  ApiError,
  createSavedNotificationFilter,
  deleteMobileNotification,
  deleteSavedNotificationFilter,
  getMobileNotifications,
  getNotificationFilters,
} from '@/services';
import type { MobileNotification, SavedNotificationFilter } from '@/types';
import { hasActiveFilters } from '@/components/notifications/shared.js';
import { NotificationCard } from '@/components/notifications/NotificationCard.js';
import { NotificationFilters } from '@/components/notifications/NotificationFilters.js';
import type { ActiveFilters } from '@/components/notifications/shared.js';

/** Animation duration for delete transitions in milliseconds */
const DELETE_ANIMATION_MS = 300;

export type NotificationSortOption = 'newest' | 'oldest' | 'app';
export const NOTIFICATION_SORT_OPTIONS: { key: NotificationSortOption; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'app', label: 'App' },
];

function getSortOptionFromStorage(): NotificationSortOption {
  if (typeof window === 'undefined') return 'newest';
  const stored = localStorage.getItem('notifications-sort');
  if (stored === 'oldest' || stored === 'app') return stored;
  return 'newest';
}

export function MobileNotificationsListPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Sort state
  const [sort, setSort] = useState<NotificationSortOption>(getSortOptionFromStorage);

  // Multi-dimension filter state
  const [filters, setFilters] = useState<ActiveFilters>({ app: [], source: '', title: '' });
  // Separate state for title input (immediate update for UX, applied on blur)
  const [titleInput, setTitleInput] = useState('');

  // Dropdown options from backend
  const [appOptions, setAppOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);

  // Saved filters
  const [savedFilters, setSavedFilters] = useState<SavedNotificationFilter[]>([]);

  // Filter name for saving
  const [filterName, setFilterName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Load filter options and saved filters on mount
  useEffect(() => {
    const loadFiltersData = async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const filtersData = await getNotificationFilters(token);
        setAppOptions(filtersData.options.app);
        setSourceOptions(filtersData.options.source);
        setSavedFilters(filtersData.savedFilters);
      } catch {
        /* Best-effort load, ignore errors */
      }
    };
    void loadFiltersData();
  }, [getAccessToken]);

  const fetchNotifications = useCallback(
    async (showRefreshing?: boolean): Promise<void> => {
      try {
        if (showRefreshing === true) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);

        const token = await getAccessToken();
        const options: { source?: string; app?: string[]; title?: string } = {};
        if (filters.source !== '') {
          options.source = filters.source;
        }
        if (filters.app.length > 0) {
          options.app = filters.app;
        }
        if (filters.title !== '') {
          options.title = filters.title;
        }
        const response = await getMobileNotifications(token, options);

        setNotifications(response.notifications);
        setNextCursor(response.nextCursor);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to fetch notifications');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [getAccessToken, filters]
  );

  const loadMore = async (): Promise<void> => {
    if (nextCursor === undefined || isLoadingMore) return;

    try {
      setIsLoadingMore(true);
      const token = await getAccessToken();
      const options: { cursor: string; source?: string; app?: string[]; title?: string } = {
        cursor: nextCursor,
      };
      if (filters.source !== '') {
        options.source = filters.source;
      }
      if (filters.app.length > 0) {
        options.app = filters.app;
      }
      if (filters.title !== '') {
        options.title = filters.title;
      }
      const response = await getMobileNotifications(token, options);

      setNotifications((prev) => [...prev, ...response.notifications]);
      setNextCursor(response.nextCursor);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load more notifications');
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Reset and fetch when filter changes
  useEffect(() => {
    setNotifications([]);
    setNextCursor(undefined);
    void fetchNotifications();
  }, [fetchNotifications]);

  const handleClearFilters = (): void => {
    setFilters({ app: [], source: '', title: '' });
    setTitleInput('');
    setFilterName('');
    setSearchParams(new URLSearchParams());
  };

  const handleDelete = async (notificationId: string): Promise<void> => {
    setDeletingIds((prev) => new Set(prev).add(notificationId));

    try {
      const token = await getAccessToken();
      await deleteMobileNotification(token, notificationId);

      // Animate out then remove
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
        setDeletingIds((prev) => {
          const next = new Set(prev);
          next.delete(notificationId);
          return next;
        });
      }, DELETE_ANIMATION_MS);
    } catch (e) {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(notificationId);
        return next;
      });
      setError(e instanceof ApiError ? e.message : 'Failed to delete notification');
    }
  };

  const handleRefresh = (): void => {
    void fetchNotifications(true);
  };

  // Apply filter from URL search params
  useEffect(() => {
    const urlApp = searchParams.get('app');
    const urlSource = searchParams.get('source');
    const urlTitle = searchParams.get('title');
    if (urlApp !== null || urlSource !== null || urlTitle !== null) {
      const newTitle = urlTitle ?? '';
      const appArray = urlApp !== null && urlApp !== '' ? urlApp.split(',') : [];
      const sourceValue = urlSource ?? '';
      setFilters({
        app: appArray,
        source: sourceValue,
        title: newTitle,
      });
      setTitleInput(newTitle);
    } else {
      // No URL params - clear all filters (e.g., when clicking "All" in sidebar)
      setFilters({ app: [], source: '', title: '' });
      setTitleInput('');
      setFilterName('');
    }
  }, [searchParams]);

  const handleSaveFilter = async (): Promise<void> => {
    if (filterName.trim() === '') {
      setError('Filter name is required');
      return;
    }
    if (!hasActiveFilters(filters, titleInput)) {
      setError('At least one filter criterion is required');
      return;
    }
    // Check for duplicate names
    if (savedFilters.some((f) => f.name === filterName.trim())) {
      setError('A filter with this name already exists');
      return;
    }

    setIsSaving(true);
    const newFilterInput: {
      name: string;
      app?: string[];
      source?: string;
      title?: string;
    } = { name: filterName.trim() };
    if (filters.app.length > 0) {
      newFilterInput.app = filters.app;
    }
    if (filters.source !== '') {
      newFilterInput.source = filters.source;
    }
    if (titleInput !== '') {
      newFilterInput.title = titleInput;
    }

    try {
      const token = await getAccessToken();
      const createdFilter = await createSavedNotificationFilter(token, newFilterInput);
      setSavedFilters((prev) => [...prev, createdFilter]);
      setFilterName('');
      setError(null);
      // Notify sidebar to refresh its filter list
      window.dispatchEvent(new CustomEvent('notification-filters-changed'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save filter');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFilter = async (filterId: string): Promise<void> => {
    const filterToDelete = savedFilters.find((f) => f.id === filterId);
    if (filterToDelete === undefined) return;

    // Optimistic update
    setSavedFilters((prev) => prev.filter((f) => f.id !== filterId));

    try {
      const token = await getAccessToken();
      await deleteSavedNotificationFilter(token, filterId);
      // Notify sidebar to refresh its filter list
      window.dispatchEvent(new CustomEvent('notification-filters-changed'));
    } catch (e) {
      // Revert on error
      setSavedFilters((prev) => [...prev, filterToDelete]);
      setError(e instanceof ApiError ? e.message : 'Failed to delete filter');
    }
  };

  // Sort handler
  const handleSortChange = (newSort: NotificationSortOption): void => {
    setSort(newSort);
    localStorage.setItem('notifications-sort', newSort);
  };

  // Sort notifications
  const sortedNotifications = [...notifications].sort((a, b) => {
    if (sort === 'newest') {
      return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    }
    if (sort === 'oldest') {
      return new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();
    }
    // 'app' - group by app name
    return a.app.localeCompare(b.app);
  });

  if (isLoading) {
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
      {/* R1 Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Notifications</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{notifications.length} notifications</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isRefreshing} title="Refresh">
          <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <ErrorBanner message={error} className="mb-6" />

      {/* NotificationFilters component */}
      <NotificationFilters
        filters={filters}
        setFilters={setFilters}
        titleInput={titleInput}
        setTitleInput={setTitleInput}
        appOptions={appOptions}
        sourceOptions={sourceOptions}
        savedFilters={savedFilters}
        filterName={filterName}
        setFilterName={setFilterName}
        isSaving={isSaving}
        onSaveFilter={handleSaveFilter}
        onDeleteFilter={handleDeleteFilter}
        onClearFilters={handleClearFilters}
      />

      {/* R3 Sort selector */}
      <div className="mb-4 flex items-center gap-2">
        <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">Sort</span>
        <div className="flex gap-1.5">
          {NOTIFICATION_SORT_OPTIONS.map(({ key, label }) => (
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

      <div className="space-y-1">
        {sortedNotifications.length === 0 ? (
          <Card title="">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="mb-4 h-12 w-12 text-slate-300 dark:text-slate-600" />
              {hasActiveFilters(filters, titleInput) ? (
                <>
                  <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200">No matching notifications</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    No notifications found matching your filters. Try different filter values.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200">No notifications yet</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Notifications from your mobile device will appear here.
                  </p>
                </>
              )}
            </div>
          </Card>
        ) : (
          sortedNotifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onDelete={(id): void => {
                void handleDelete(id);
              }}
              isDeleting={deletingIds.has(notification.id)}
            />
          ))
        )}
      </div>

      {/* Load more button */}
      {nextCursor !== undefined ? (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            onClick={(): void => {
              void loadMore();
            }}
            isLoading={isLoadingMore}
          >
            Load More
          </Button>
        </div>
      ) : null}

      {notifications.length > 0 ? (
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Showing {String(notifications.length)} notification
          {notifications.length === 1 ? '' : 's'}
          {nextCursor !== undefined ? ' (more available)' : ''}
        </p>
      ) : null}
    </Layout>
  );
}
