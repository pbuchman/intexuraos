import { useState, useEffect, useCallback, useMemo } from 'react';
import { Trash2, AlertCircle, Scissors, X, ArrowUpDown } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/context';
import {
  listPruneCandidates,
  deletePruneCandidates,
  type PruneCandidateResponse,
} from '@/services/linearApi';
import { PruneCandidateRow } from '@/components/prune-candidates/PruneCandidateRow';
import {
  ALL_CATEGORIES,
  CATEGORY_CONFIG,
  INACTIVE_PILL_CLASS,
  SORT_OPTIONS,
  FILTER_STORAGE_KEY,
  SORT_STORAGE_KEY,
  type PruneCategory,
  type PruneSortOption,
} from '@/components/prune-candidates/shared';

// --- Storage helpers ---

function loadFiltersFromStorage(): PruneCategory[] {
  const stored = localStorage.getItem(FILTER_STORAGE_KEY);
  if (stored !== null) {
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((s): s is PruneCategory =>
          ALL_CATEGORIES.includes(s as PruneCategory),
        );
        if (valid.length > 0) return valid;
      }
    } catch {
      // Invalid JSON, use default
    }
  }
  return ALL_CATEGORIES;
}

function loadSortFromStorage(): PruneSortOption {
  const stored = localStorage.getItem(SORT_STORAGE_KEY);
  if (stored === 'score' || stored === 'category' || stored === 'identifier') {
    return stored;
  }
  return 'score';
}

// --- Sorting logic ---

function sortCandidates(
  candidates: PruneCandidateResponse[],
  sort: PruneSortOption,
): PruneCandidateResponse[] {
  const sorted = [...candidates];
  switch (sort) {
    case 'score':
      sorted.sort((a, b) => b.score - a.score);
      break;
    case 'category':
      sorted.sort((a, b) => a.category.localeCompare(b.category));
      break;
    case 'identifier':
      sorted.sort((a, b) => a.identifier.localeCompare(b.identifier));
      break;
  }
  return sorted;
}

// --- PageHeader ---

interface PageHeaderProps {
  totalCount: number;
  categoryCounts: Record<PruneCategory, number>;
}

function PageHeader({ totalCount, categoryCounts }: PageHeaderProps): React.JSX.Element {
  const parts: string[] = [`${String(totalCount)} candidate${totalCount !== 1 ? 's' : ''}`];
  const topCategory = ALL_CATEGORIES
    .map((c) => ({ category: c, count: categoryCounts[c] }))
    .sort((a, b) => b.count - a.count)[0];
  if (topCategory !== undefined && topCategory.count > 0) {
    parts.push(`${String(topCategory.count)} ${CATEGORY_CONFIG[topCategory.category].label.toLowerCase()}`);
  }

  return (
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Issue Cleanup</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {totalCount > 0 ? parts.join(' \u00B7 ') : 'Issues classified for deletion by the pruning scheduler'}
        </p>
      </div>
    </div>
  );
}

// --- CategoryPipeline ---

interface CategoryPipelineProps {
  counts: Record<PruneCategory, number>;
  activeFilters: PruneCategory[];
  onToggle: (category: PruneCategory) => void;
}

function CategoryPipeline({ counts, activeFilters, onToggle }: CategoryPipelineProps): React.JSX.Element {
  const activeSet = useMemo(() => new Set(activeFilters), [activeFilters]);

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {ALL_CATEGORIES.map((category) => {
        const cfg = CATEGORY_CONFIG[category];
        const count = counts[category];
        const isActive = activeSet.has(category);

        return (
          <button
            key={category}
            onClick={(): void => { onToggle(category); }}
            className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
              isActive ? cfg.activeClass : INACTIVE_PILL_CLASS
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${cfg.dotClass}`} />
            {cfg.label}
            <span className="font-medium">{String(count)}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- SortSelector ---

interface SortSelectorProps {
  activeSort: PruneSortOption;
  onChangeSort: (sort: PruneSortOption) => void;
}

function SortSelector({ activeSort, onChangeSort }: SortSelectorProps): React.JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2">
      <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500">
        Sort
      </span>
      <div className="flex gap-1.5">
        {SORT_OPTIONS.map(({ key, label }) => (
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

// --- ColumnHeader ---

function ColumnHeader(): React.JSX.Element {
  return (
    <div className="mb-1 hidden grid-cols-[28px_1fr_80px_120px_100px_36px] px-4 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-500 lg:grid">
      <div></div>
      <div>Issue</div>
      <div className="text-center">Score</div>
      <div className="text-center">Category</div>
      <div>Reason</div>
      <div></div>
    </div>
  );
}

// --- Main Page ---

export function LinearPruneCandidatesPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const [allCandidates, setAllCandidates] = useState<PruneCandidateResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<{ deleted: number; failed: number } | null>(null);

  // Filter and sort state
  const [activeFilters, setActiveFilters] = useState<PruneCategory[]>(loadFiltersFromStorage);
  const [activeSort, setActiveSort] = useState<PruneSortOption>(loadSortFromStorage);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchCandidates = useCallback(async (isRefresh = false): Promise<void> => {
    try {
      setError(null);
      if (isRefresh) {
        setRefreshing(true);
      }
      const token = await getAccessToken();
      const data = await listPruneCandidates(token);
      setAllCandidates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load prune candidates');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchCandidates();
  }, [fetchCandidates]);

  // Compute counts per category (from ALL candidates, not filtered)
  const categoryCounts = useMemo(() => {
    const counts: Record<PruneCategory, number> = {
      cancelled: 0,
      duplicate: 0,
      'sub-issue': 0,
      'simple-fix': 0,
      'review-only': 0,
      other: 0,
    };
    for (const c of allCandidates) {
      counts[c.category]++;
    }
    return counts;
  }, [allCandidates]);

  // Filter + sort candidates
  const filteredCandidates = useMemo(() => {
    const filterSet = new Set(activeFilters);
    const filtered = allCandidates.filter((c) => filterSet.has(c.category));
    return sortCandidates(filtered, activeSort);
  }, [allCandidates, activeFilters, activeSort]);

  // Prune selection when candidates change
  useEffect(() => {
    const validIds = new Set(filteredCandidates.map((c) => c.id));
    setSelectedIds((prev) => {
      const pruned = new Set([...prev].filter((id) => validIds.has(id)));
      if (pruned.size === prev.size) return prev;
      return pruned;
    });
  }, [filteredCandidates]);

  const handleToggleFilter = useCallback((category: PruneCategory): void => {
    setActiveFilters((prev) => {
      const set = new Set(prev);
      if (set.has(category)) {
        set.delete(category);
      } else {
        set.add(category);
      }
      const next = [...set];
      const result = next.length === 0 ? ALL_CATEGORIES : next;
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(result));
      return result;
    });
  }, []);

  const handleChangeSort = useCallback((sort: PruneSortOption): void => {
    setActiveSort(sort);
    localStorage.setItem(SORT_STORAGE_KEY, sort);
  }, []);

  const handleToggleSelection = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((): void => {
    setSelectedIds(new Set(filteredCandidates.map((c) => c.id)));
  }, [filteredCandidates]);

  const handleDeselectAll = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  const handleDeleteAll = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      const token = await getAccessToken();
      const result = await deletePruneCandidates(token);
      setDeleteResult({ deleted: result.deleted, failed: result.failedDeletions.length });
      setShowConfirm(false);
      setAllCandidates([]);
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete candidates');
      setShowConfirm(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDismiss = useCallback((id: string): void => {
    setAllCandidates((prev) => prev.filter((c) => c.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  return (
    <Layout>
      <PageHeader
        totalCount={allCandidates.length}
        categoryCounts={categoryCounts}
      />

      {/* Success banner */}
      {deleteResult !== null ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-900/20">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <p className="text-sm font-medium text-green-800 dark:text-green-300">
            Successfully deleted {deleteResult.deleted} issue
            {deleteResult.deleted !== 1 ? 's' : ''} from Linear
            {deleteResult.failed > 0
              ? ` (${String(deleteResult.failed)} failed)`
              : ''}
          </p>
          <button
            onClick={(): void => { setDeleteResult(null); }}
            className="ml-auto rounded p-0.5 text-green-600 transition-colors hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900/40"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Error banner */}
      {error !== null ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          <p className="text-sm font-medium text-red-800 dark:text-red-300">{error}</p>
          <button
            onClick={(): void => { setError(null); }}
            className="ml-auto rounded p-0.5 text-red-600 transition-colors hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="py-12">
          <div className="mx-auto max-w-md">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full w-1/3 animate-progress-slide rounded-full bg-blue-500" />
            </div>
            <p className="mt-3 text-center text-sm text-slate-500 dark:text-slate-400">
              Loading prune candidates…
            </p>
          </div>
        </div>
      ) : allCandidates.length === 0 && deleteResult === null ? (
        /* Empty state */
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="py-12 text-center">
            <Scissors className="mx-auto mb-4 h-8 w-8 text-slate-400 dark:text-slate-500" />
            <p className="text-slate-600 dark:text-slate-300">
              No issues scheduled for deletion
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The scheduler will classify issues for deletion on its next run.
            </p>
          </div>
        </div>
      ) : allCandidates.length > 0 ? (
        <>
          <CategoryPipeline
            counts={categoryCounts}
            activeFilters={activeFilters}
            onToggle={handleToggleFilter}
          />

          <SortSelector activeSort={activeSort} onChangeSort={handleChangeSort} />

          {/* Batch selection summary */}
          {filteredCandidates.length > 0 ? (
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {String(selectedIds.size)} of {String(filteredCandidates.length)} candidate{filteredCandidates.length !== 1 ? 's' : ''} selected
              </span>
              {filteredCandidates.length >= 2 ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    disabled={selectedIds.size === filteredCandidates.length}
                    className="text-xs text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-blue-400"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={handleDeselectAll}
                    disabled={selectedIds.size === 0}
                    className="text-xs text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-blue-400"
                  >
                    Deselect all
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <ColumnHeader />

          {/* Refresh progress bar */}
          <div className={`mb-2 h-0.5 w-full overflow-hidden rounded-full ${refreshing ? 'bg-slate-700' : ''}`}>
            {refreshing ? (
              <div className="animate-progress-slide h-full w-2/5 rounded-full bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
            ) : null}
          </div>

          {filteredCandidates.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
              <div className="py-12 text-center">
                <p className="mb-4 text-slate-600 dark:text-slate-300">
                  No candidates match the selected filters
                </p>
                <button
                  onClick={(): void => {
                    const next = ALL_CATEGORIES;
                    setActiveFilters(next);
                    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(next));
                  }}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
                >
                  Clear filters
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredCandidates.map((candidate) => (
                <PruneCandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  isSelected={selectedIds.has(candidate.id)}
                  onToggleSelection={handleToggleSelection}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      {/* Floating batch action bar */}
      {selectedIds.size > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {String(selectedIds.size)} selected
          </span>
          <button
            onClick={(): void => { setShowConfirm(true); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
          >
            <Trash2 className="h-4 w-4" />
            Delete All
          </button>
          <button
            onClick={handleDeselectAll}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {/* Confirmation modal */}
      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800">
            {isDeleting ? (
              <div className="flex flex-col items-center justify-center p-12">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
                <p className="mt-4 text-lg font-medium text-slate-700 dark:text-slate-200">
                  Deleting issues...
                </p>
              </div>
            ) : (
              <>
                <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 rounded-lg bg-red-100 p-2 dark:bg-red-900/50">
                      <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        Delete Issues from Linear
                      </h2>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Review before proceeding
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={(): void => { setShowConfirm(false); }}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <p className="text-slate-700 dark:text-slate-200">
                    Are you sure you want to delete{' '}
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {allCandidates.length} issue{allCandidates.length !== 1 ? 's' : ''}
                    </span>{' '}
                    from Linear? This action is a soft-delete and can be recovered from
                    Linear&apos;s trash.
                  </p>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
                  <Button
                    variant="secondary"
                    onClick={(): void => { setShowConfirm(false); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={(): void => { void handleDeleteAll(); }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete {allCandidates.length} Issue{allCandidates.length !== 1 ? 's' : ''}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
