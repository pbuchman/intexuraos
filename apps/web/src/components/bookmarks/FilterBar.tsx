import { Button } from '@/components';
import type { ListBookmarksFilters } from '@/services/bookmarksApi';

interface FilterBarProps {
  filters: ListBookmarksFilters;
  onFiltersChange: (filters: ListBookmarksFilters) => void;
  availableTags: string[];
}

const INACTIVE_CLASS = 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500';

const archiveOptions: { value: boolean | undefined; label: string; dotClass: string }[] = [
  { value: undefined, label: 'All', dotClass: 'bg-blue-500' },
  { value: false, label: 'Active', dotClass: 'bg-green-500' },
  { value: true, label: 'Archived', dotClass: 'bg-slate-400' },
];

export function FilterBar({ filters, onFiltersChange, availableTags }: FilterBarProps): React.JSX.Element {
  const hasFilters =
    filters.archived !== undefined ||
    (filters.tags !== undefined && filters.tags.length > 0) ||
    filters.ogFetchStatus !== undefined;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="flex gap-1.5">
        {archiveOptions.map((opt) => {
          const isActive = filters.archived === opt.value;
          return (
            <button
              key={String(opt.value ?? '')}
              onClick={(): void => {
                const newFilters: ListBookmarksFilters = {};
                if (opt.value !== undefined) {
                  newFilters.archived = opt.value;
                }
                if (filters.tags !== undefined) {
                  newFilters.tags = filters.tags;
                }
                if (filters.ogFetchStatus !== undefined) {
                  newFilters.ogFetchStatus = filters.ogFetchStatus;
                }
                onFiltersChange(newFilters);
              }}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                  : INACTIVE_CLASS
              }`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${opt.dotClass}`} />
              {opt.label}
            </button>
          );
        })}
      </div>

      {availableTags.length > 0 ? (
        <select
          value={filters.tags !== undefined && filters.tags.length > 0 ? filters.tags[0] : ''}
          onChange={(e): void => {
            const val = e.target.value;
            const newFilters: ListBookmarksFilters = {};
            if (filters.archived !== undefined) {
              newFilters.archived = filters.archived;
            }
            if (val !== '') {
              newFilters.tags = [val];
            }
            if (filters.ogFetchStatus !== undefined) {
              newFilters.ogFetchStatus = filters.ogFetchStatus;
            }
            onFiltersChange(newFilters);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
        >
          <option value="">All Tags</option>
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      ) : null}

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(): void => {
            onFiltersChange({});
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
