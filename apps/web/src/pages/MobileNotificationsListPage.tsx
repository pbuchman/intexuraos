import { useEffect, useState, useCallback } from 'react';
import { Layout, Button, Card } from '@/components';
import { useAuth } from '@/context';
import { getMobileNotifications, deleteMobileNotification, ApiError } from '@/services';
import type { MobileNotification } from '@/types';
import { Trash2, Bell, RefreshCw, X, Filter } from 'lucide-react';

type FilterType = 'none' | 'source' | 'app';

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
        <button
          onClick={handleDeleteClick}
          disabled={isDeleting || showDeleteConfirm}
          className="shrink-0 rounded-lg p-2 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Delete notification"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function MobileNotificationsListPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [notifications, setNotifications] = useState<MobileNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [filterType, setFilterType] = useState<FilterType>('none');
  const [filterValue, setFilterValue] = useState('');

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
        const options: { source?: string; app?: string } = {};
        if (filterType === 'source' && filterValue !== '') {
          options.source = filterValue;
        } else if (filterType === 'app' && filterValue !== '') {
          options.app = filterValue;
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
    [getAccessToken, filterType, filterValue]
  );

  const loadMore = async (): Promise<void> => {
    if (nextCursor === undefined || isLoadingMore) return;

    try {
      setIsLoadingMore(true);
      const token = await getAccessToken();
      const options: { cursor: string; source?: string; app?: string } = { cursor: nextCursor };
      if (filterType === 'source' && filterValue !== '') {
        options.source = filterValue;
      } else if (filterType === 'app' && filterValue !== '') {
        options.app = filterValue;
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

  const handleFilterTypeChange = (newType: FilterType): void => {
    setFilterType(newType);
    setFilterValue('');
  };

  const handleFilterValueChange = (value: string): void => {
    setFilterValue(value);
  };

  const handleClearFilter = (): void => {
    setFilterType('none');
    setFilterValue('');
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
          <div className="flex items-start justify-between">
            <span>{error}</span>
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
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Filter className="h-5 w-5 text-slate-400" />
        <select
          value={filterType}
          onChange={(e): void => {
            handleFilterTypeChange(e.target.value as FilterType);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="none">No Filter</option>
          <option value="source">Filter by Source</option>
          <option value="app">Filter by App</option>
        </select>

        {filterType !== 'none' ? (
          <>
            <input
              type="text"
              value={filterValue}
              onChange={(e): void => {
                handleFilterValueChange(e.target.value);
              }}
              placeholder={filterType === 'source' ? 'e.g., tasker' : 'e.g., com.whatsapp'}
              className="w-48 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleClearFilter}
              className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              Clear
            </button>
          </>
        ) : null}
      </div>

      <div className="space-y-4">
        {notifications.length === 0 ? (
          <Card title="">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="mb-4 h-12 w-12 text-slate-300" />
              {filterType !== 'none' && filterValue !== '' ? (
                <>
                  <h3 className="text-lg font-medium text-slate-700">No matching notifications</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    No notifications found matching your filter. Try a different filter value.
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
