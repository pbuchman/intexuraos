import { useSearchParams } from 'react-router-dom';
import { Filter, Save, X } from 'lucide-react';
import type { SavedNotificationFilter } from '@/types';
import type { ActiveFilters } from './shared.js';
import { hasActiveFilters, filtersMatchSaved } from './shared.js';
import { MultiSelectDropdown } from './MultiSelectDropdown.js';

interface NotificationFiltersProps {
  filters: ActiveFilters;
  setFilters: React.Dispatch<React.SetStateAction<ActiveFilters>>;
  titleInput: string;
  setTitleInput: React.Dispatch<React.SetStateAction<string>>;
  appOptions: string[];
  sourceOptions: string[];
  savedFilters: SavedNotificationFilter[];
  filterName: string;
  setFilterName: React.Dispatch<React.SetStateAction<string>>;
  isSaving: boolean;
  onSaveFilter: () => Promise<void>;
  onDeleteFilter: (filterId: string) => Promise<void>;
  onClearFilters: () => void;
}

export function NotificationFilters({
  filters,
  setFilters,
  titleInput,
  setTitleInput,
  appOptions,
  sourceOptions,
  savedFilters,
  filterName,
  setFilterName,
  isSaving,
  onSaveFilter,
  onDeleteFilter,
  onClearFilters,
}: NotificationFiltersProps): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();

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

  return (
    <div className="mb-6 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center gap-2">
        <Filter className="h-5 w-5 text-slate-500 dark:text-slate-400" />
        <span className="font-medium text-slate-700 dark:text-slate-200">Filters</span>
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
          <label className="text-xs text-slate-500 dark:text-slate-400">Source</label>
          <select
            value={filters.source}
            onChange={(e): void => {
              setFilters((prev) => ({ ...prev, source: e.target.value }));
            }}
            className="min-w-[140px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:border-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:border-slate-500"
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
          <label className="text-xs text-slate-500 dark:text-slate-400">Title contains</label>
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
            className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
          />
        </div>

        {/* Clear button */}
        {hasActiveFilters(filters, titleInput) ? (
          <button
            onClick={onClearFilters}
            className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            Clear All
          </button>
        ) : null}
      </div>

      {/* Save filter row - only show if filters are active AND modified from any selected saved filter */}
      {(() : React.JSX.Element | null => {
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
          <div className="mt-4 flex items-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-700">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 dark:text-slate-400">Filter name</label>
              <input
                type="text"
                value={filterName}
                onChange={(e): void => {
                  setFilterName(e.target.value);
                }}
                placeholder="e.g., Important"
                className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:placeholder-slate-400"
              />
            </div>
            <button
              onClick={(): void => {
                void onSaveFilter();
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
        <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Saved Filters</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {savedFilters.map((filter) => (
              <div
                key={filter.id}
                className="flex items-center gap-1 rounded-full bg-white pl-3 pr-1 py-1 text-sm text-slate-700 shadow-sm ring-1 ring-slate-200 hover:ring-blue-400 transition-all dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600 dark:hover:ring-blue-500"
              >
                <button
                  onClick={(): void => {
                    handleApplySavedFilter(filter);
                  }}
                  className="hover:text-blue-600 transition-colors dark:hover:text-blue-400"
                  aria-label={`Apply filter ${filter.name}`}
                >
                  {filter.name}
                </button>
                <button
                  onClick={(): void => {
                    void onDeleteFilter(filter.id);
                  }}
                  className="p-1 text-slate-400 hover:text-red-600 rounded-full hover:bg-slate-100 transition-colors dark:hover:bg-slate-600 dark:hover:text-red-400"
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
  );
}
