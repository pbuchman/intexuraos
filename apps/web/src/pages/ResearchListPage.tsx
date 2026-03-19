import { memo, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpDown, Plus, Star, Trash2 } from 'lucide-react';
import { Button, ErrorBanner, Layout } from '@/components';
import { useAuth } from '@/context';
import { useResearches } from '@/hooks';
import { formatRelative } from '@/utils/dateFormat';
import { stripMarkdown } from '@/utils';
import { toggleResearchFavourite } from '@/services/researchAgentApi';
import {
  getProviderForModel,
  type Research,
} from '@/services/researchAgentApi.types';
import {
  ALL_RESEARCH_GROUP_STATUSES,
  deriveGroupStatus,
  getAccentShadow,
  INACTIVE_SEGMENT_CLASS,
  RESEARCH_GROUP_STATUS_CONFIG,
  RESEARCH_SORT_OPTIONS,
  ResearchStatusBadge,
  type ResearchGroupStatus,
  type ResearchSortOption,
} from '@/components/research/shared.js';

const FILTER_STORAGE_KEY = 'research-status-filter';
const SORT_STORAGE_KEY = 'research-sort';

const DEFAULT_FILTERS: ResearchGroupStatus[] = ['processing', 'action-required', 'completed', 'failed'];

function loadFiltersFromStorage(): Set<ResearchGroupStatus> {
  const stored = localStorage.getItem(FILTER_STORAGE_KEY);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(
          parsed.filter((s): s is ResearchGroupStatus =>
            ALL_RESEARCH_GROUP_STATUSES.includes(s as ResearchGroupStatus),
          ),
        );
      }
    } catch {
      // Invalid JSON, use default
    }
  }
  return new Set<ResearchGroupStatus>(DEFAULT_FILTERS);
}

function loadSortFromStorage(): ResearchSortOption {
  const stored = localStorage.getItem(SORT_STORAGE_KEY);
  if (stored === 'created' || stored === 'completed' || stored === 'favourite') {
    return stored;
  }
  return 'created';
}

function safeTimestamp(dateStr: string): number {
  const ms = new Date(dateStr).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function sortResearches(items: Research[], sort: ResearchSortOption): Research[] {
  const sorted = [...items];
  if (sort === 'created') {
    sorted.sort((a, b) => safeTimestamp(b.startedAt) - safeTimestamp(a.startedAt));
  } else if (sort === 'completed') {
    sorted.sort((a, b) => {
      const aTime = a.completedAt !== undefined ? safeTimestamp(a.completedAt) : 0;
      const bTime = b.completedAt !== undefined ? safeTimestamp(b.completedAt) : 0;
      return bTime - aTime;
    });
  } else {
    // favourite: favourites first, then by startedAt desc
    sorted.sort((a, b) => {
      const aFav = a.favourite === true ? 1 : 0;
      const bFav = b.favourite === true ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      return safeTimestamp(b.startedAt) - safeTimestamp(a.startedAt);
    });
  }
  return sorted;
}

// --- PageHeader ---

function PageHeader({ total, counts }: { total: number; counts: Record<ResearchGroupStatus, number> }): React.JSX.Element {
  const parts: string[] = [`${String(total)} research${total !== 1 ? 'es' : ''}`];
  const processing = counts.processing;
  const failed = counts.failed;
  if (processing > 0) parts.push(`${String(processing)} processing`);
  if (failed > 0) parts.push(`${String(failed)} failed`);

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Previous Researches</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {parts.join(' \u00B7 ')}
        </p>
      </div>
      <Link to="/research/new">
        <Button>
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Research</span>
        </Button>
      </Link>
    </div>
  );
}

// --- StatusPipeline ---

interface StatusPipelineProps {
  counts: Record<ResearchGroupStatus, number>;
  activeFilters: Set<ResearchGroupStatus>;
  onToggle: (status: ResearchGroupStatus) => void;
}

function StatusPipeline({ counts, activeFilters, onToggle }: StatusPipelineProps): React.JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {ALL_RESEARCH_GROUP_STATUSES.map((status) => {
        const config = RESEARCH_GROUP_STATUS_CONFIG[status];
        const count = counts[status];
        const isActive = activeFilters.has(status);

        return (
          <button
            key={status}
            onClick={(): void => { onToggle(status); }}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive ? config.activeClass : INACTIVE_SEGMENT_CLASS
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${config.dotClass}`} />
            {config.label}
            <span className="font-medium">{String(count)}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- SortSelector ---

interface SortSelectorProps {
  activeSort: ResearchSortOption;
  onChangeSort: (sort: ResearchSortOption) => void;
}

function SortSelector({ activeSort, onChangeSort }: SortSelectorProps): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2">
      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">
        Sort
      </span>
      <div className="flex gap-1.5">
        {RESEARCH_SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            onClick={(): void => { onChangeSort(key); }}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              activeSort === key
                ? 'border-slate-400 bg-slate-100 font-medium text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-200'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// --- ResearchRow ---

interface ResearchRowProps {
  research: Research;
  onDelete: () => Promise<void>;
  onToggleFavourite: (researchId: string, favourite: boolean) => void;
  updatingFavourite: string | null;
}

const ResearchRow = memo(function ResearchRow({ research, onDelete, onToggleFavourite, updatingFavourite }: ResearchRowProps): React.JSX.Element {
  const navigate = useNavigate();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const groupStatus = deriveGroupStatus(research.status);
  const isDraft = research.status === 'draft';
  const deleteLabel = isDraft ? 'Discard' : 'Delete';

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const uniqueProviders = [...new Set(research.selectedModels.map(getProviderForModel))];

  return (
    <div
      onClick={(): void => { void navigate(`/research/${research.id}`); }}
      className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(groupStatus)}`}
    >
      {/* Desktop layout */}
      <div className="hidden sm:grid sm:grid-cols-[1fr_auto_140px_120px] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">
            {research.title !== '' ? stripMarkdown(research.title) : 'Untitled Research'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ResearchStatusBadge status={research.status} />
          {uniqueProviders.map((provider) => (
            <span key={provider} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {provider}
            </span>
          ))}
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {formatRelative(research.startedAt)}
        </span>
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e): void => {
              e.stopPropagation();
              onToggleFavourite(research.id, !(research.favourite ?? false));
            }}
            disabled={updatingFavourite === research.id}
            className="p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50 dark:hover:bg-slate-700"
            aria-label={research.favourite === true ? 'Unfavourite' : 'Favourite'}
          >
            <Star
              className={`h-4 w-4 ${research.favourite === true ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-500'}`}
            />
          </button>
          <button
            onClick={(e): void => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            className="rounded p-1 text-slate-300 opacity-0 transition-all hover:text-red-500 group-hover:opacity-100 dark:text-slate-600 dark:hover:text-red-400"
            aria-label={deleteLabel}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile layout */}
      <div className="sm:hidden">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">
            {research.title !== '' ? stripMarkdown(research.title) : 'Untitled Research'}
          </p>
          <span className="flex-shrink-0 text-xs text-slate-400">
            {formatRelative(research.startedAt)}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ResearchStatusBadge status={research.status} />
          {uniqueProviders.map((provider) => (
            <span key={provider} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {provider}
            </span>
          ))}
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={(e): void => {
                e.stopPropagation();
                onToggleFavourite(research.id, !(research.favourite ?? false));
              }}
              disabled={updatingFavourite === research.id}
              className="p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-50 dark:hover:bg-slate-700"
              aria-label={research.favourite === true ? 'Unfavourite' : 'Favourite'}
            >
              <Star
                className={`h-4 w-4 ${research.favourite === true ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-500'}`}
              />
            </button>
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              className="rounded p-1 text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400"
              aria-label={deleteLabel}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Delete overlay */}
      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
          onClick={(e): void => { e.stopPropagation(); }}
        >
          <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">{deleteLabel} this research?</p>
            <button
              onClick={(): void => { setShowDeleteConfirm(false); }}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={(): void => { void handleDelete(); }}
              disabled={isDeleting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : deleteLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.research.id === nextProps.research.id &&
    prevProps.research.status === nextProps.research.status &&
    prevProps.research.favourite === nextProps.research.favourite &&
    prevProps.updatingFavourite === nextProps.updatingFavourite
  );
});

// --- Main Page ---

export function ResearchListPage(): React.JSX.Element {
  const { researches, loading, loadingMore, error, hasMore, loadMore, deleteResearch, refresh } =
    useResearches();
  const { getAccessToken } = useAuth();
  const [updatingFavourite, setUpdatingFavourite] = useState<string | null>(null);
  const [favouriteError, setFavouriteError] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<ResearchGroupStatus>>(() => loadFiltersFromStorage());
  const [activeSort, setActiveSort] = useState<ResearchSortOption>(() => loadSortFromStorage());

  const handleToggleFavourite = (researchId: string, favourite: boolean): void => {
    setUpdatingFavourite(researchId);
    setFavouriteError(null);
    void (async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        await toggleResearchFavourite(token, researchId, favourite);
        await refresh();
      } catch (err) {
        setFavouriteError(err instanceof Error ? err.message : 'Failed to update favourite');
      } finally {
        setUpdatingFavourite(null);
      }
    })();
  };

  const handleToggleFilter = (status: ResearchGroupStatus): void => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handleChangeSort = (sort: ResearchSortOption): void => {
    setActiveSort(sort);
    localStorage.setItem(SORT_STORAGE_KEY, sort);
  };

  const counts = useMemo(() => {
    const c: Record<ResearchGroupStatus, number> = {
      processing: 0,
      'action-required': 0,
      completed: 0,
      failed: 0,
      draft: 0,
    };
    for (const r of researches) {
      c[deriveGroupStatus(r.status)]++;
    }
    return c;
  }, [researches]);

  const filteredResearches = useMemo(() => {
    const filtered = activeFilters.size === 0
      ? researches
      : researches.filter((r) => activeFilters.has(deriveGroupStatus(r.status)));
    return sortResearches(filtered, activeSort);
  }, [researches, activeFilters, activeSort]);

  if (loading && researches.length === 0) {
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
      <PageHeader total={researches.length} counts={counts} />

      <ErrorBanner message={error} className="mb-6" />
      <ErrorBanner message={favouriteError} className="mb-6" />

      {researches.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-4 text-slate-600 dark:text-slate-300">No researches yet</p>
          <Link to="/research/new" className="text-blue-600 underline dark:text-blue-400">
            Start your first research
          </Link>
        </div>
      ) : (
        <>
          <StatusPipeline
            counts={counts}
            activeFilters={activeFilters}
            onToggle={handleToggleFilter}
          />
          <SortSelector activeSort={activeSort} onChangeSort={handleChangeSort} />

          <div className="space-y-2">
            {filteredResearches.map((research) => (
              <ResearchRow
                key={research.id}
                research={research}
                onDelete={async (): Promise<void> => {
                  await deleteResearch(research.id);
                }}
                onToggleFavourite={handleToggleFavourite}
                updatingFavourite={updatingFavourite}
              />
            ))}
          </div>

          {hasMore ? (
            <div className="flex justify-center pt-4">
              <Button
                variant="secondary"
                onClick={(): void => {
                  void loadMore();
                }}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-transparent" />
                    <span>Loading...</span>
                  </div>
                ) : (
                  'Load More'
                )}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </Layout>
  );
}
