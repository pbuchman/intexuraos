import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Layout } from '@/components';
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
import { Bell, Check, ChevronDown, Filter, RefreshCw, Save, Trash2, X } from 'lucide-react';

/**
 * Active filter state for multi-dimension filtering.
 * App supports multiple selections (OR within dimension), source is single-select.
 */
interface ActiveFilters {
  app: string[];
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
          <h3 className="break-words font-semibold text-slate-900">{notification.title}</h3>
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
    filters.app.length > 0 ||
    filters.source !== '' ||
    filters.title !== '' ||
    (titleInput !== undefined && titleInput !== '')
  );
}

/**
 * Check if two string arrays have the same values (order-independent).
 */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, idx) => val === sortedB[idx]);
}

/**
 * Check if current filters match a saved filter's values.
 */
function filtersMatchSaved(
  filters: ActiveFilters,
  titleInput: string,
  savedFilter: SavedNotificationFilter
): boolean {
  const savedApp = savedFilter.app ?? [];
  const savedSource = savedFilter.source ?? '';
  const savedTitle = savedFilter.title ?? '';

  return (
    arraysEqual(filters.app, savedApp) &&
    filters.source === savedSource &&
    (filters.title === savedTitle || titleInput === savedTitle)
  );
}

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allLabel: string;
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  allLabel,
}: MultiSelectDropdownProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const toggleOption = (option: string): void => {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option));
    } else {
      onChange([...selected, option]);
    }
  };

  const displayText =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selected[0]
        : `${String(selected.length)} selected`;

  return (
    <div className="relative flex flex-col gap-1">
      <label className="text-xs text-slate-500">{label}</label>
      <button
        type="button"
        onClick={(): void => {
          setIsOpen(!isOpen);
        }}
        className="flex min-w-[140px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={(): void => {
              setIsOpen(false);
            }}
          />
          <div className="absolute top-full z-20 mt-1 max-h-60 w-full min-w-[200px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {options.map((option) => (
              <button
                key={option}
                type="button"
                onClick={(): void => {
                  toggleOption(option);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
              >
                <div
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    selected.includes(option)
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300'
                  }`}
                >
                  {selected.includes(option) ? <Check className="h-3 w-3" /> : null}
                </div>
                <span className="truncate text-sm text-slate-700">{option}</span>
              </button>
            ))}
            {options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">No options available</div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
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

  const handleApplySavedFilter = (filter: SavedNotificationFilter): void => {
    const newApp = filter.app ?? [];
    const newSource = filter.source ?? '';
    const newTitle = filter.title ?? '';

    setFilters({ app: newApp, source: newSource, title: newTitle });
    setTitleInput(newTitle);

    const params = new URLSearchParams();
    params.set('filterId', filter.id);
    if (newApp.length > 0) params.set('app', newApp.join(','));
    if (newSource !== '') params.set('source', newSource);
    if (newTitle !== '') params.set('title', newTitle);
    setSearchParams(params);
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
          {/* App multi-select */}
          <MultiSelectDropdown
            label="App"
            options={appOptions}
            selected={filters.app}
            onChange={(selected): void => {
              setFilters((prev) => ({ ...prev, app: selected }));
            }}
            allLabel="All Apps"
          />

          {/* Source single-select */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Source</label>
            <select
              value={filters.source}
              onChange={(e): void => {
                setFilters((prev) => ({ ...prev, source: e.target.value }));
              }}
              className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Sources</option>
              {sourceOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
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

        {/* Save filter row - only show if filters are active AND modified from any selected saved filter */}
        {((): React.JSX.Element | null => {
          if (!hasActiveFilters(filters, titleInput)) return null;

          const currentFilterId = searchParams.get('filterId');
          if (currentFilterId !== null) {
            const currentSavedFilter = savedFilters.find((f) => f.id === currentFilterId);
            if (
              currentSavedFilter !== undefined &&
              filtersMatchSaved(filters, titleInput, currentSavedFilter)
            ) {
              return null;
            }
          }

          return (
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
          );
        })()}

        {/* Saved filters list */}
        {savedFilters.length > 0 ? (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <span className="text-xs font-medium text-slate-500">Saved Filters</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {savedFilters.map((filter) => (
                <div
                  key={filter.id}
                  className="flex items-center gap-1 rounded-full bg-white pl-3 pr-1 py-1 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 hover:ring-blue-400 transition-all"
                >
                  <button
                    onClick={(): void => {
                      handleApplySavedFilter(filter);
                    }}
                    className="hover:text-blue-600 transition-colors"
                    aria-label={`Apply filter ${filter.name}`}
                  >
                    {filter.name}
                  </button>
                  <button
                    onClick={(): void => {
                      void handleDeleteFilter(filter.id);
                    }}
                    className="p-1 text-slate-400 hover:text-red-600 rounded-full hover:bg-slate-100 transition-colors"
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
