import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronDown, Plus, Trash2, RefreshCw, Clock, AlertCircle } from 'lucide-react';
import { Button, Card, Layout } from '@/components';
import { useAuth } from '@/context';
import { useCompositeFeed, useDataSources } from '@/hooks';
import { createCompositeFeed } from '@/services/compositeFeedApi';
import { getNotificationFilters } from '@/services/mobileNotificationsApi';
import type { DataSource, NotificationFilterOptions } from '@/types';

const MAX_PURPOSE_LENGTH = 1000;
const MAX_STATIC_SOURCES = 5;
const MAX_NOTIFICATION_FILTERS = 3;

interface NotificationFilterFormData {
  tempId: string;
  name: string;
  app: string[];
  source: string;
  title: string;
}

function generateTempId(): string {
  return Math.random().toString(36).substring(2, 11);
}

function createEmptyFilter(): NotificationFilterFormData {
  return {
    tempId: generateTempId(),
    name: '',
    app: [],
    source: '',
    title: '',
  };
}

interface MultiSelectDropdownProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  allLabel: string;
  disabled?: boolean;
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  allLabel,
  disabled = false,
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
      : `${String(selected.length)} selected`;

  return (
    <div className="relative flex flex-col gap-1">
      <label className="text-xs text-slate-500">{label}</label>
      <button
        type="button"
        onClick={(): void => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        disabled={disabled}
        className="flex w-[140px] items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
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

interface DataSourceSelectorProps {
  dataSources: DataSource[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

function DataSourceSelector({
  dataSources,
  selectedIds,
  onChange,
  disabled = false,
}: DataSourceSelectorProps): React.JSX.Element {
  const toggleSource = (id: string): void => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else if (selectedIds.length < MAX_STATIC_SOURCES) {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-700">
        Static Data Sources ({selectedIds.length}/{MAX_STATIC_SOURCES})
      </div>
      <p className="text-sm text-slate-500">
        Select up to {MAX_STATIC_SOURCES} data sources to include in this feed.
      </p>
      <div className="space-y-2 mt-3">
        {dataSources.map((ds) => {
          const isSelected = selectedIds.includes(ds.id);
          const isAtLimit = selectedIds.length >= MAX_STATIC_SOURCES && !isSelected;

          return (
            <button
              key={ds.id}
              type="button"
              onClick={(): void => {
                if (!disabled && !isAtLimit) toggleSource(ds.id);
              }}
              disabled={disabled || isAtLimit}
              className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : isAtLimit
                    ? 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                  isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300'
                }`}
              >
                {isSelected ? <Check className="h-3 w-3" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-900 truncate">{ds.title}</div>
                <div className="text-sm text-slate-500 truncate">
                  {ds.content.slice(0, 100)}
                  {ds.content.length > 100 ? '...' : ''}
                </div>
              </div>
            </button>
          );
        })}
        {dataSources.length === 0 ? (
          <div className="text-sm text-slate-400 py-4 text-center">
            No data sources available. Create one first.
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface NotificationFilterCardProps {
  filter: NotificationFilterFormData;
  index: number;
  filterOptions: NotificationFilterOptions;
  onChange: (filter: NotificationFilterFormData) => void;
  onRemove: () => void;
  disabled?: boolean;
}

function NotificationFilterCard({
  filter,
  index,
  filterOptions,
  onChange,
  onRemove,
  disabled = false,
}: NotificationFilterCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-slate-700">Filter {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="text-slate-400 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-500">Filter Name</label>
          <input
            type="text"
            value={filter.name}
            onChange={(e): void => {
              onChange({ ...filter, name: e.target.value });
            }}
            placeholder="e.g., Banking Alerts"
            disabled={disabled}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
          />
        </div>

        <div className="flex flex-wrap gap-3">
          <MultiSelectDropdown
            label="Apps"
            options={filterOptions.app}
            selected={filter.app}
            onChange={(selected): void => {
              onChange({ ...filter, app: selected });
            }}
            allLabel="All Apps"
            disabled={disabled}
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Source</label>
            <select
              value={filter.source}
              onChange={(e): void => {
                onChange({ ...filter, source: e.target.value });
              }}
              disabled={disabled}
              className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">All Sources</option>
              {filterOptions.source.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Title contains</label>
            <input
              type="text"
              value={filter.title}
              onChange={(e): void => {
                onChange({ ...filter, title: e.target.value });
              }}
              placeholder="Search in title..."
              disabled={disabled}
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CompositeFeedFormPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { getAccessToken } = useAuth();

  const isEditMode = id !== undefined && id !== '';
  const {
    compositeFeed,
    loading: fetchLoading,
    error: fetchError,
    updateCompositeFeed,
    getSnapshot,
    snapshot,
    snapshotLoading,
  } = useCompositeFeed(id ?? '');

  const { dataSources, loading: dataSourcesLoading } = useDataSources();

  const [purpose, setPurpose] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [notificationFilters, setNotificationFilters] = useState<NotificationFilterFormData[]>([]);
  const [filterOptions, setFilterOptions] = useState<NotificationFilterOptions>({
    app: [],
    device: [],
    source: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showSnapshotLoader, setShowSnapshotLoader] = useState(false);
  const loaderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loadFilterOptions = async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        const data = await getNotificationFilters(token);
        setFilterOptions(data.options);
      } catch {
        /* Best-effort load */
      }
    };
    void loadFilterOptions();
  }, [getAccessToken]);

  useEffect(() => {
    if (isEditMode && compositeFeed !== null) {
      setPurpose(compositeFeed.purpose);
      setSelectedSourceIds(compositeFeed.staticSourceIds);
      setNotificationFilters(
        compositeFeed.notificationFilters.map((f) => ({
          tempId: f.id,
          name: f.name,
          app: f.app ?? [],
          source: f.source ?? '',
          title: f.title ?? '',
        }))
      );
    }
  }, [isEditMode, compositeFeed]);

  useEffect(() => {
    if (isEditMode && compositeFeed !== null) {
      void getSnapshot();
    }
  }, [isEditMode, compositeFeed, getSnapshot]);

  useEffect(() => {
    if (snapshotLoading) {
      setShowSnapshotLoader(true);
      if (loaderTimeoutRef.current !== null) {
        clearTimeout(loaderTimeoutRef.current);
      }
    } else if (showSnapshotLoader) {
      loaderTimeoutRef.current = setTimeout(() => {
        setShowSnapshotLoader(false);
      }, 1000);
    }
    return (): void => {
      if (loaderTimeoutRef.current !== null) {
        clearTimeout(loaderTimeoutRef.current);
      }
    };
  }, [snapshotLoading, showSnapshotLoader]);

  const handleAddFilter = (): void => {
    if (notificationFilters.length < MAX_NOTIFICATION_FILTERS) {
      setNotificationFilters([...notificationFilters, createEmptyFilter()]);
    }
  };

  const handleRemoveFilter = (tempId: string): void => {
    setNotificationFilters(notificationFilters.filter((f) => f.tempId !== tempId));
  };

  const handleUpdateFilter = (updated: NotificationFilterFormData): void => {
    setNotificationFilters(
      notificationFilters.map((f) => (f.tempId === updated.tempId ? updated : f))
    );
  };

  const validateFilters = (): string | null => {
    for (let i = 0; i < notificationFilters.length; i++) {
      const filter = notificationFilters[i];
      if (filter === undefined) continue;

      if (filter.name.trim() === '') {
        return `Filter ${String(i + 1)} requires a name`;
      }
      if (filter.app.length === 0 && filter.source === '' && filter.title.trim() === '') {
        return `Filter ${String(i + 1)} requires at least one criterion (app, source, or title)`;
      }
    }
    return null;
  };

  const handleSubmit = async (): Promise<void> => {
    if (purpose.trim().length === 0) {
      setError('Purpose is required');
      return;
    }

    if (purpose.length > MAX_PURPOSE_LENGTH) {
      setError(`Purpose exceeds maximum length of ${String(MAX_PURPOSE_LENGTH)} characters`);
      return;
    }

    if (selectedSourceIds.length === 0 && notificationFilters.length === 0) {
      setError('Select at least one data source or add a notification filter');
      return;
    }

    const filterError = validateFilters();
    if (filterError !== null) {
      setError(filterError);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const filtersToSave = notificationFilters.map((f) => {
        const result: { name: string; app?: string[]; source?: string; title?: string } = {
          name: f.name.trim(),
        };
        if (f.app.length > 0) result.app = f.app;
        if (f.source !== '') result.source = f.source;
        if (f.title.trim() !== '') result.title = f.title.trim();
        return result;
      });

      if (isEditMode) {
        await updateCompositeFeed({
          purpose: purpose.trim(),
          staticSourceIds: selectedSourceIds,
          notificationFilters: filtersToSave,
        });
      } else {
        const token = await getAccessToken();
        await createCompositeFeed(token, {
          purpose: purpose.trim(),
          staticSourceIds: selectedSourceIds,
          notificationFilters: filtersToSave,
        });
      }

      if (isEditMode) {
        setShowSuccess(true);
        void getSnapshot({ refresh: true });
        setTimeout(() => {
          setShowSuccess(false);
        }, 3000);
      } else {
        void navigate('/data-insights/composite-feeds');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save composite feed');
    } finally {
      setSaving(false);
    }
  };

  const canSubmit =
    purpose.trim().length > 0 &&
    purpose.length <= MAX_PURPOSE_LENGTH &&
    (selectedSourceIds.length > 0 || notificationFilters.length > 0) &&
    !saving;

  if (isEditMode && fetchLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (isEditMode && fetchError !== null) {
    return (
      <Layout>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {fetchError}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">
          {isEditMode ? 'Edit Composite Feed' : 'Create Composite Feed'}
        </h2>
        <p className="text-slate-600">
          {isEditMode
            ? 'Update your composite feed configuration.'
            : 'Create a feed that aggregates data sources and notification filters.'}
        </p>
      </div>

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {showSuccess ? (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 text-green-700">
          <Check className="h-5 w-5" />
          <span>Composite feed saved successfully</span>
        </div>
      ) : null}

      <div className="space-y-6">
        <Card title="Purpose">
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              Describe what this feed is used for. This helps generate a meaningful name and guides
              LLM consumption.
            </p>
            <textarea
              value={purpose}
              onChange={(e): void => {
                setPurpose(e.target.value);
              }}
              placeholder="e.g., Track my banking transactions and credit card alerts for monthly expense analysis..."
              className="w-full rounded-lg border border-slate-200 p-3 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[100px]"
              disabled={saving}
            />
            <p
              className={`text-sm ${purpose.length > MAX_PURPOSE_LENGTH ? 'text-red-600' : 'text-slate-500'}`}
            >
              {purpose.length.toLocaleString()}/{MAX_PURPOSE_LENGTH.toLocaleString()} characters
            </p>
          </div>
        </Card>

        <Card title="Data Sources">
          {dataSourcesLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            <DataSourceSelector
              dataSources={dataSources}
              selectedIds={selectedSourceIds}
              onChange={setSelectedSourceIds}
              disabled={saving}
            />
          )}
        </Card>

        <Card title="Notification Filters">
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Add up to {MAX_NOTIFICATION_FILTERS} notification filters to include mobile
              notifications matching specific criteria.
            </p>

            {notificationFilters.map((filter, index) => (
              <NotificationFilterCard
                key={filter.tempId}
                filter={filter}
                index={index}
                filterOptions={filterOptions}
                onChange={handleUpdateFilter}
                onRemove={(): void => {
                  handleRemoveFilter(filter.tempId);
                }}
                disabled={saving}
              />
            ))}

            {notificationFilters.length < MAX_NOTIFICATION_FILTERS ? (
              <Button type="button" variant="secondary" onClick={handleAddFilter} disabled={saving}>
                <Plus className="mr-2 h-4 w-4" />
                Add Filter
              </Button>
            ) : null}
          </div>
        </Card>

        {isEditMode && compositeFeed !== null ? (
          <Card title="Snapshot Preview">
            <div className="relative">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500">
                    Pre-computed snapshot data (refreshed every 15 minutes)
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={(): void => {
                      void getSnapshot({ refresh: true });
                    }}
                    disabled={snapshotLoading}
                    isLoading={snapshotLoading}
                  >
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh
                  </Button>
                </div>

                {snapshotLoading && snapshot === null ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                  </div>
                ) : snapshot === null ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <div className="flex gap-2">
                      <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
                      <div>
                        <p className="font-medium text-amber-900">Snapshot Not Yet Generated</p>
                        <p className="text-sm text-amber-700 mt-1">
                          Snapshots are generated every 15 minutes by the scheduler. Please check back
                          soon.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1 text-slate-600">
                        <Clock className="h-4 w-4" />
                        <span>
                          Generated: {new Date(snapshot.generatedAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="text-slate-500">
                        Expires: {new Date(snapshot.expiresAt).toLocaleString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>

                    {snapshot.staticSources.length > 0 ? (
                      <div>
                        <h4 className="text-sm font-medium text-slate-700 mb-2">
                          Static Sources ({snapshot.staticSources.length})
                        </h4>
                        <div className="space-y-2">
                          {snapshot.staticSources.map((source) => {
                            const rows = source.content.split('\n').length;
                            const chars = source.content.length;
                            return (
                              <div
                                key={source.id}
                                className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                              >
                                <div className="font-medium text-slate-900 text-sm">{source.name}</div>
                                <div className="text-xs text-slate-500 mt-1">
                                  {rows} rows, {chars.toLocaleString()} characters
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {snapshot.notifications.length > 0 ? (
                      <div>
                        <h4 className="text-sm font-medium text-slate-700 mb-2">
                          Notification Filters ({snapshot.notifications.length})
                        </h4>
                        <div className="space-y-2">
                          {snapshot.notifications.map((filter) => (
                            <div
                              key={filter.filterId}
                              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                            >
                              <div className="font-medium text-slate-900 text-sm">
                                {filter.filterName}
                              </div>
                              <div className="text-xs text-slate-500 mt-1">
                                {filter.items.length} notifications
                                {filter.criteria.app !== undefined && filter.criteria.app.length > 0
                                  ? ` from ${filter.criteria.app.join(', ')}`
                                  : ''}
                              </div>
                              {filter.items.length === 1000 ? (
                                <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
                                  <AlertCircle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                                  <span className="text-xs text-amber-800">
                                    Reached 1000 notification limit. Some may be missing. Consider
                                    narrowing your filter criteria.
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {showSnapshotLoader && snapshot !== null ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 backdrop-blur-[1px] transition-opacity duration-300">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                    <span className="text-sm text-slate-600">Refreshing snapshot...</span>
                  </div>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={(): void => {
              void navigate('/data-insights/composite-feeds');
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={(): void => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
            isLoading={saving}
          >
            {isEditMode ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
