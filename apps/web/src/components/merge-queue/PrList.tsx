import { ArrowDown } from 'lucide-react';
import type { MergeQueuePr, PrFilterStatus } from '@/types';
import { getPrStatus } from '@/utils/mergeQueueStatus';
import { PrRow } from './PrRow.js';

interface PrListProps {
  prs: MergeQueuePr[];
  activeFilters: Set<PrFilterStatus>;
  isLoading: boolean;
  excludedPrNumbers: Set<number>;
  onToggleExclusion: (prNumber: number) => void;
  onSelectAll: () => void;
  onDeselectAll: (eligiblePrNumbers: number[]) => void;
}

function LoadingSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
      ))}
    </div>
  );
}

export function PrList({ prs, activeFilters, isLoading, excludedPrNumbers, onToggleExclusion, onSelectAll, onDeselectAll }: PrListProps): React.JSX.Element {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  const filteredPrs = prs.filter((pr) => activeFilters.has(getPrStatus(pr)));

  // First mergeable + eligible PR is "next to merge"
  const nextToMergeNumber = filteredPrs.find(
    (pr) => getPrStatus(pr) === 'mergeable' && pr.authorIsEligible
  )?.number ?? null;

  // Use full prs array (pre-filter) so counter is stable across filter changes
  const allEligiblePrs = prs.filter((pr) => pr.authorIsEligible);
  const selectedCount = allEligiblePrs.filter((pr) => !excludedPrNumbers.has(pr.number)).length;
  const totalEligible = allEligiblePrs.length;

  return (
    <div>
      {/* Merge order indicator */}
      <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <ArrowDown className="h-3 w-3" />
        <span>Merge order: oldest first</span>
      </div>

      {/* Selection summary */}
      {totalEligible > 0 ? (
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-slate-600 dark:text-slate-400">
            {String(selectedCount)} of {String(totalEligible)} PRs selected for merge
          </span>
          {totalEligible >= 2 ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={selectedCount === totalEligible}
                className="text-xs text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-blue-400"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={(): void => { onDeselectAll(allEligiblePrs.map((pr) => pr.number)); }}
                disabled={selectedCount === 0}
                className="text-xs text-blue-600 hover:underline disabled:text-slate-400 disabled:no-underline dark:text-blue-400"
              >
                Deselect all
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Column header (desktop only) */}
      <div className="mb-1 hidden px-4 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 lg:grid lg:grid-cols-[32px_60px_1fr_120px_100px_100px]">
        <span></span>
        <span>PR#</span>
        <span>Title</span>
        <span>Author</span>
        <span>Status</span>
        <span>Conflicts</span>
      </div>

      {/* PR rows */}
      <div className="space-y-1">
        {filteredPrs.length > 0 ? (
          filteredPrs.map((pr) => (
            <PrRow
              key={pr.number}
              pr={pr}
              isNextToMerge={pr.number === nextToMergeNumber}
              isExcluded={excludedPrNumbers.has(pr.number)}
              onToggleExclusion={pr.authorIsEligible ? onToggleExclusion : null}
            />
          ))
        ) : (
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
            No PRs match the selected filters
          </p>
        )}
      </div>
    </div>
  );
}
