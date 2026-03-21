import { useState, useCallback, useMemo } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Layout } from '@/components';
import { useMergeQueue } from '@/hooks/useMergeQueue';
import { BranchSelector } from '@/components/merge-queue/BranchSelector';
import { WatchStatusCard } from '@/components/merge-queue/WatchStatusCard';
import { PrStatusPipeline } from '@/components/merge-queue/PrStatusPipeline';
import { PrList } from '@/components/merge-queue/PrList';
import { MergeHistoryTimeline } from '@/components/merge-queue/MergeHistoryTimeline';
import { getPrStatus } from '@/utils/mergeQueueStatus';
import type { PrFilterStatus } from '@/types';

const DEFAULT_OWNER = 'pbuchman';
const DEFAULT_REPO = 'intexuraos';

const ALL_FILTERS = new Set<PrFilterStatus>(['mergeable', 'pending', 'blocked']);

export function MergeQueuePage(): React.JSX.Element {
  const {
    branches, selectedBranch, setSelectedBranch,
    prs, watches,
    loading, error, prsLoading, prsError,
    isToggling, toggleError,
    fetchInitialData, handleToggleWatch,
  } = useMergeQueue(DEFAULT_OWNER, DEFAULT_REPO);

  const [activeFilters, setActiveFilters] = useState<Set<PrFilterStatus>>(new Set(ALL_FILTERS));

  const handleToggleFilter = useCallback((status: PrFilterStatus): void => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  // Compute filter counts (single source of truth for stats)
  const filterCounts = useMemo(() => {
    const counts: Record<PrFilterStatus, number> = { mergeable: 0, pending: 0, blocked: 0 };
    for (const pr of prs) {
      counts[getPrStatus(pr)] += 1;
    }
    return counts;
  }, [prs]);

  // Find watch for selected branch — prefer active over drained so a newly
  // created watch is picked up even when a stale drained watch still exists.
  const currentWatch = useMemo(() => {
    if (selectedBranch === null) return null;
    const branchWatches = watches.filter((w) => w.baseBranch === selectedBranch);
    return branchWatches.find((w) => w.status === 'active')
      ?? branchWatches.find((w) => w.status === 'drained')
      ?? null;
  }, [watches, selectedBranch]);

  const isSelectedBranchBlocked = useMemo(() => {
    if (selectedBranch === null) return false;
    const branch = branches.find((b) => b.name === selectedBranch);
    return branch?.blocked === true;
  }, [branches, selectedBranch]);

  // Merged PRs for timeline (from active/drained watch)
  const mergedPrs = currentWatch !== null ? currentWatch.mergedPrs : [];

  // Error state
  if (error !== null && !loading) {
    return (
      <Layout>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
          <button
            onClick={(): void => { void fetchInitialData(); }}
            className="mt-3 inline-flex items-center gap-2 rounded-md bg-red-100 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-400 dark:hover:bg-red-900/70"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </Layout>
    );
  }

  // Loading state
  if (loading) {
    return (
      <Layout>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>
        <div className="mt-6 flex items-center gap-3 text-slate-500">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm">Loading merge queue...</span>
        </div>
      </Layout>
    );
  }

  // Empty branches (no open PRs in repo)
  if (branches.length === 0) {
    return (
      <Layout>
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          No open pull requests found in {DEFAULT_OWNER}/{DEFAULT_REPO}
        </p>
      </Layout>
    );
  }

  return (
    <Layout>
      <h2 className="mb-6 text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>

      {/* BranchSelector */}
      <div className="mb-4">
        <BranchSelector
          branches={branches}
          selected={selectedBranch}
          onSelect={setSelectedBranch}
        />
      </div>

      {/* WatchStatusCard */}
      <div className="mb-4">
        <WatchStatusCard
          watch={currentWatch}
          onToggle={handleToggleWatch}
          isToggling={isToggling}
          blocked={isSelectedBranchBlocked}
        />
        {toggleError !== null ? (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{toggleError}</p>
        ) : null}
      </div>

      {/* PrStatusPipeline */}
      {selectedBranch !== null ? (
        <div className="mb-4">
          <PrStatusPipeline
            counts={filterCounts}
            activeFilters={activeFilters}
            onToggle={handleToggleFilter}
          />
        </div>
      ) : null}

      {/* PrList */}
      {selectedBranch !== null ? (
        <div className="mb-4">
          {prsError !== null && !prsLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/30">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <p className="text-sm text-red-700 dark:text-red-400">{prsError}</p>
            </div>
          ) : prs.length === 0 && !prsLoading ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No open PRs targeting {selectedBranch}
            </p>
          ) : (
            <PrList
              prs={prs}
              activeFilters={activeFilters}
              isLoading={prsLoading}
            />
          )}
        </div>
      ) : null}

      {/* MergeHistoryTimeline */}
      {mergedPrs.length > 0 ? (
        <div className="rounded-lg">
          <MergeHistoryTimeline mergedPrs={mergedPrs} owner={DEFAULT_OWNER} repo={DEFAULT_REPO} />
        </div>
      ) : null}
    </Layout>
  );
}
