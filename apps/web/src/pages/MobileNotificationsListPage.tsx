import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout, Button, Card } from '@/components';
import { useAuth } from '@/context';
import {
  getMobileNotifications,
  deleteMobileNotification,
  getFilterValues,
  ApiError,
} from '@/services';
import { getUserSettings, updateUserSettings } from '@/services/authApi';
import type { MobileNotification, NotificationFilter } from '@/types';
import { Trash2, Bell, RefreshCw, X, Filter, Save } from 'lucide-react';

/**
 * Active filter state for multi-dimension filtering.
 */
interface ActiveFilters {
  app: string;
  source: string;
  title: string;
}

/** Animation duration for delete transitions in milliseconds */
const DELETE_ANIMATION_MS = 300;

/**
 * Format relative time (e.g., "2h ago", "5m ago")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) {
    return 'just now';
  }
  if (diffMin < 60) {
    return `${String(diffMin)}m ago`;
  }
  if (diffHour < 24) {
    return `${String(diffHour)}h ago`;
  }
  if (diffDay < 7) {
    return `${String(diffDay)}d ago`;
  }

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Pill badge for notification metadata.
 */
function Badge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

interface NotificationCardProps {
  notification: MobileNotification;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}

/**
 * Individual notification card styled like Android notifications.
 */
function NotificationCard({
  notification,
  onDelete,
  isDeleting,
}: NotificationCardProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteClick = (): void => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = (): void => {
    setShowDeleteConfirm(false);
    onDelete(notification.id);
  };

  const handleDeleteCancel = (): void => {
    setShowDeleteConfirm(false);
  };

  return (
    <div
      className={`group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all duration-300 ${
        isDeleting ? 'scale-95 opacity-50' : 'hover:border-slate-300 hover:shadow-md'
      }`}
    >
      {/* Delete confirmation dialog */}
      {showDeleteConfirm ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="mb-2 text-sm text-red-700">
            Are you sure you want to delete this notification?
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDeleteConfirm}
              className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={handleDeleteCancel}
              className="rounded bg-slate-200 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Header: Tags and time */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{notification.device}</Badge>
          <Badge>{notification.app}</Badge>
          <Badge>{notification.source}</Badge>
        </div>
        <span className="text-xs text-slate-400">
          {formatRelativeTime(notification.receivedAt)}
        </span>
      </div>

      {/* Title */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="break-all font-semibold text-slate-900">{notification.title}</h3>
          {/* Body text */}
          {notification.text !== '' ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 wrap-anywhere">
              {notification.text}
            </p>
          ) : null}
        </div>

        {/* Delete button - always visible for mobile accessibility */}
        <div className="flex shrink-0 gap-1">
          <button
            onClick={handleDeleteClick}
            disabled={isDeleting || showDeleteConfirm}
            className="rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Delete notification"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Check if active filters have any values set.
 * Also checks titleInput for pending debounced input.
 */
function hasActiveFilters(filters: ActiveFilters, titleInput?: string): boolean {
  return (
    filters.app !== '' ||
    filters.source !== '' ||
    filters.title !== '' ||
    (titleInput !== undefined && titleInput !== '')
  );
}

export function MobileNotificationsListPage(): React.JSX.Element {
  const { getAccessToken, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // Multi-dimension filter state
  const [filters, setFilters] = useState<ActiveFilters>({ app: '', source: '', title: '' });
  // Separate state for title input (immediate update for UX, applied on blur)
  const [titleInput, setTitleInput] = useState('');

  // Dropdown options from backend
  const [appOptions, setAppOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);

  // Saved filters
  const [savedFilters, setSavedFilters] = useState<NotificationFilter[]>([]);

  // Filter name for saving
  const [filterName, setFilterName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Load dropdown options on mount
  useEffect(() => {
    const loadFilterOptions = async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const [apps, sources] = await Promise.all([
          getFilterValues(token, 'app'),
          getFilterValues(token, 'source'),
        ]);
        setAppOptions(apps);
        setSourceOptions(sources);
      } catch {
        /* Best-effort load, ignore errors */
      }
    };
    void loadFilterOptions();
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
        const options: { source?: string; app?: string; title?: string } = {};
        if (filters.source !== '') {
          options.source = filters.source;
        }
        if (filters.app !== '') {
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
      const options: { cursor: string; source?: string; app?: string; title?: string } = {
        cursor: nextCursor,
      };
      if (filters.source !== '') {
        options.source = filters.source;
      }
      if (filters.app !== '') {
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
    setFilters({ app: '', source: '', title: '' });
    setTitleInput('');
    setFilterName('');
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

  // Fetch saved filters on mount
  useEffect(() => {
    const fetchSavedFilters = async (): Promise<void> => {
      if (user?.sub === undefined) return;
      try {
        const token = await getAccessToken();
        const settings = await getUserSettings(token, user.sub);
        setSavedFilters(settings.notifications.filters);
      } catch {
        /* Best-effort fetch, ignore errors */
      }
    };
    void fetchSavedFilters();
  }, [getAccessToken, user?.sub]);

  // Apply filter from URL search params
  useEffect(() => {
    const urlApp = searchParams.get('app');
    const urlSource = searchParams.get('source');
    const urlTitle = searchParams.get('title');
    if (urlApp !== null || urlSource !== null || urlTitle !== null) {
      const newTitle = urlTitle ?? '';
      setFilters({
        app: urlApp ?? '',
        source: urlSource ?? '',
        title: newTitle,
      });
      setTitleInput(newTitle);
    }
  }, [searchParams]);

  const handleSaveFilter = async (): Promise<void> => {
    if (user?.sub === undefined) return;
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
    const newFilter: NotificationFilter = { name: filterName.trim() };
    if (filters.app !== '') {
      newFilter.app = filters.app;
    }
    if (filters.source !== '') {
      newFilter.source = filters.source;
    }
    // Use titleInput to capture pending debounced input
    if (titleInput !== '') {
      newFilter.title = titleInput;
    }

    const newFilters = [...savedFilters, newFilter];

    try {
      const token = await getAccessToken();
      await updateUserSettings(token, user.sub, { filters: newFilters });
      setSavedFilters(newFilters);
      setFilterName('');
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save filter');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteFilter = async (name: string): Promise<void> => {
    if (user?.sub === undefined) return;

    const newFilters = savedFilters.filter((f) => f.name !== name);
    setSavedFilters(newFilters);

    try {
      const token = await getAccessToken();
      await updateUserSettings(token, user.sub, { filters: newFilters });
    } catch (e) {
      // Revert on error
      setSavedFilters(savedFilters);
      setError(e instanceof ApiError ? e.message : 'Failed to delete filter');
    }
  };

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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Notifications</h2>
          <p className="text-slate-600">Notifications captured from your mobile device</p>
        </div>
        <Button variant="secondary" onClick={handleRefresh} isLoading={isRefreshing}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words">{error}</span>
            <button
              onClick={(): void => {
                setError(null);
              }}
              className="text-red-400 hover:text-red-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Filter controls */}
      <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Filter className="h-5 w-5 text-slate-500" />
          <span className="font-medium text-slate-700">Filters</span>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* App dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">App</label>
            <select
              value={filters.app}
              onChange={(e): void => {
                setFilters((prev) => ({ ...prev, app: e.target.value }));
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Apps</option>
              {appOptions.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </select>
          </div>

          {/* Source dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Source</label>
            <select
              value={filters.source}
              onChange={(e): void => {
                setFilters((prev) => ({ ...prev, source: e.target.value }));
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Sources</option>
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>
          </div>

          {/* Title text input */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Title contains</label>
            <input
              type="text"
              value={titleInput}
              onChange={(e): void => {
                setTitleInput(e.target.value);
              }}
              onBlur={(): void => {
                setFilters((prev) => ({ ...prev, title: titleInput }));
              }}
              onKeyDown={(e): void => {
                if (e.key === 'Enter') {
                  setFilters((prev) => ({ ...prev, title: titleInput }));
                }
              }}
              placeholder="Search in title..."
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Clear button */}
          {hasActiveFilters(filters, titleInput) ? (
            <button
              onClick={handleClearFilters}
              className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            >
              Clear All
            </button>
          ) : null}
        </div>

        {/* Save filter row */}
        {hasActiveFilters(filters, titleInput) ? (
          <div className="mt-4 flex items-end gap-3 border-t border-slate-200 pt-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Filter name</label>
              <input
                type="text"
                value={filterName}
                onChange={(e): void => {
                  setFilterName(e.target.value);
                }}
                placeholder="e.g., Important"
                className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={(): void => {
                void handleSaveFilter();
              }}
              disabled={isSaving || filterName.trim() === ''}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save Filter
            </button>
          </div>
        ) : null}

        {/* Saved filters list */}
        {savedFilters.length > 0 ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <span className="text-xs font-medium text-slate-500">Saved Filters</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {savedFilters.map((filter) => (
                <div
                  key={filter.name}
                  className="flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm text-slate-700 shadow-sm"
                >
                  <span>{filter.name}</span>
                  <button
                    onClick={(): void => {
                      void handleDeleteFilter(filter.name);
                    }}
                    className="text-slate-400 hover:text-red-600"
                    aria-label={`Delete filter ${filter.name}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        {notifications.length === 0 ? (
          <Card title="">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="mb-4 h-12 w-12 text-slate-300" />
              {hasActiveFilters(filters, titleInput) ? (
                <>
                  <h3 className="text-lg font-medium text-slate-700">No matching notifications</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    No notifications found matching your filters. Try different filter values.
                  </p>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-medium text-slate-700">No notifications yet</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Notifications from your mobile device will appear here.
                  </p>
                </>
              )}
            </div>
          </Card>
        ) : (
          notifications.map((notification) => (
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
        <p className="mt-6 text-center text-sm text-slate-500">
          Showing {String(notifications.length)} notification{notifications.length === 1 ? '' : 's'}
        </p>
      ) : null}
    </Layout>
  );
}
