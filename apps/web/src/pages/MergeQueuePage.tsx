import { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context';
import { listBranches, listPrs, listWatches, createWatch, cancelWatch } from '@/services/mergeQueueApi';
import { BranchSelector } from '@/components/merge-queue/BranchSelector';
import { WatchStatusCard } from '@/components/merge-queue/WatchStatusCard';
import { PrStatusPipeline } from '@/components/merge-queue/PrStatusPipeline';
import { PrList } from '@/components/merge-queue/PrList';
import { MergeHistoryTimeline } from '@/components/merge-queue/MergeHistoryTimeline';
import { getPrStatus } from '@/components/merge-queue/PrRow';
import type { MergeQueueBranch, MergeQueuePr, MergeQueueWatch, PrFilterStatus } from '@/types';

const DEFAULT_OWNER = 'pbuchman';
const DEFAULT_REPO = 'intexuraos';

const ALL_FILTERS = new Set<PrFilterStatus>(['mergeable', 'pending', 'blocked']);
const WATCH_POLL_MS = 30000;
const PRS_POLL_MS = 60000;

export function MergeQueuePage(): React.JSX.Element {
  const { getAccessToken } = useAuth();

  const [branches, setBranches] = useState<MergeQueueBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [prs, setPrs] = useState<MergeQueuePr[]>([]);
  const [watches, setWatches] = useState<MergeQueueWatch[]>([]);
  const [activeFilters, setActiveFilters] = useState<Set<PrFilterStatus>>(new Set(ALL_FILTERS));
  const [isToggling, setIsToggling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prsLoading, setPrsLoading] = useState(false);

  const selectedBranchRef = useRef(selectedBranch);
  selectedBranchRef.current = selectedBranch;

  // Fetch branches and watches on mount
  const fetchInitialData = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const token = await getAccessToken();
      const [branchesRes, watchesRes] = await Promise.all([
        listBranches(token, DEFAULT_OWNER, DEFAULT_REPO),
        listWatches(token, DEFAULT_OWNER, DEFAULT_REPO),
      ]);
      setBranches(branchesRes.branches);
      setWatches(watchesRes.watches);

      // Auto-select branch with most PRs
      if (branchesRes.branches.length > 0) {
        const sorted = [...branchesRes.branches].sort((a, b) => b.openPrCount - a.openPrCount);
        const best = sorted[0];
        if (best !== undefined) {
          setSelectedBranch(best.name);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load merge queue data');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    void fetchInitialData();
  }, [fetchInitialData]);

  // Fetch PRs when branch changes
  const fetchPrs = useCallback(async (branch: string): Promise<void> => {
    try {
      setPrsLoading(true);
      const token = await getAccessToken();
      const res = await listPrs(token, DEFAULT_OWNER, DEFAULT_REPO, branch);
      // Only update if this is still the selected branch
      if (selectedBranchRef.current === branch) {
        setPrs(res.pullRequests);
      }
    } catch {
      // Silently fail PR fetch — user can see stale data
    } finally {
      setPrsLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (selectedBranch !== null) {
      setPrs([]);
      void fetchPrs(selectedBranch);
    }
  }, [selectedBranch, fetchPrs]);

  // Poll watches every 30s (pause when tab hidden)
  useEffect(() => {
    const poll = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return;
      try {
        const token = await getAccessToken();
        const res = await listWatches(token, DEFAULT_OWNER, DEFAULT_REPO);
        setWatches(res.watches);
      } catch {
        // Silently fail polling
      }
    };

    const intervalId = setInterval(() => { void poll(); }, WATCH_POLL_MS);
    return (): void => {
      clearInterval(intervalId);
    };
  }, [getAccessToken]);

  // Poll PRs every 60s (pause when tab hidden)
  useEffect(() => {
    const poll = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return;
      const branch = selectedBranchRef.current;
      if (branch === null) return;
      try {
        const token = await getAccessToken();
        const res = await listPrs(token, DEFAULT_OWNER, DEFAULT_REPO, branch);
        if (selectedBranchRef.current === branch) {
          setPrs(res.pullRequests);
        }
      } catch {
        // Silently fail polling
      }
    };

    const intervalId = setInterval(() => { void poll(); }, PRS_POLL_MS);
    return (): void => {
      clearInterval(intervalId);
    };
  }, [getAccessToken]);

  // Toggle watch handler
  const handleToggleWatch = useCallback(async (): Promise<void> => {
    if (selectedBranch === null) return;
    setIsToggling(true);
    try {
      const token = await getAccessToken();
      const activeWatch = watches.find(
        (w) => w.baseBranch === selectedBranch && w.status === 'active'
      );

      if (activeWatch !== undefined) {
        await cancelWatch(token, activeWatch.watchId);
      } else {
        await createWatch(token, DEFAULT_OWNER, DEFAULT_REPO, selectedBranch);
      }

      // Refetch watches immediately
      const res = await listWatches(token, DEFAULT_OWNER, DEFAULT_REPO);
      setWatches(res.watches);
    } catch {
      // Toggle failed — watches will be stale until next poll
    } finally {
      setIsToggling(false);
    }
  }, [selectedBranch, watches, getAccessToken]);

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

  // Compute subtitle stats
  const open = prs.length;
  const mergeable = prs.filter((p) => p.mergeable === true && p.checksStatus === 'success').length;
  const blocked = prs.filter((p) => p.mergeable === false || p.checksStatus === 'failure').length;
  const pending = open - mergeable - blocked;

  // Compute filter counts
  const filterCounts: Record<PrFilterStatus, number> = { mergeable: 0, pending: 0, blocked: 0 };
  for (const pr of prs) {
    filterCounts[getPrStatus(pr)] += 1;
  }

  // Find active watch for selected branch
  const currentWatch = selectedBranch !== null
    ? watches.find((w) => w.baseBranch === selectedBranch && (w.status === 'active' || w.status === 'drained')) ?? null
    : null;

  // Merged PRs for timeline (from active/drained watch)
  const mergedPrs = currentWatch !== null ? currentWatch.mergedPrs : [];

  // Error state
  if (error !== null && !loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
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
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>
        <div className="mt-6 flex items-center gap-3 text-slate-500">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm">Loading merge queue...</span>
        </div>
      </div>
    );
  }

  // Empty branches (no open PRs in repo)
  if (branches.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          No open pull requests found in {DEFAULT_OWNER}/{DEFAULT_REPO}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* PageHeader */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Merge Queue</h2>
        {selectedBranch !== null && !prsLoading ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {String(open)} open &middot; {String(mergeable)} mergeable &middot; {String(blocked)} blocked &middot; {String(pending)} pending
          </p>
        ) : null}
      </div>

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
          onToggle={(): void => { void handleToggleWatch(); }}
          isToggling={isToggling}
        />
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
          {prs.length === 0 && !prsLoading ? (
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
          <MergeHistoryTimeline mergedPrs={mergedPrs} />
        </div>
      ) : null}
    </div>
  );
}
