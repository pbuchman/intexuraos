import { ArrowDown } from 'lucide-react';
import type { MergeQueuePr, PrFilterStatus } from '@/types';
import { PrRow, getPrStatus } from './PrRow.js';

interface PrListProps {
  prs: MergeQueuePr[];
  activeFilters: Set<PrFilterStatus>;
  isLoading: boolean;
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

export function PrList({ prs, activeFilters, isLoading }: PrListProps): React.JSX.Element {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  const filteredPrs = prs.filter((pr) => activeFilters.has(getPrStatus(pr)));

  // First mergeable + eligible PR is "next to merge"
  const nextToMergeNumber = filteredPrs.find(
    (pr) => getPrStatus(pr) === 'mergeable' && pr.authorIsEligible
  )?.number ?? null;

  return (
    <div>
      {/* Merge order indicator */}
      <div className="mb-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <ArrowDown className="h-3 w-3" />
        <span>Merge order: oldest first</span>
      </div>

      {/* Column header (desktop only) */}
      <div className="mb-1 hidden px-4 text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 lg:grid lg:grid-cols-[60px_1fr_120px_100px_100px]">
        <span>PR#</span>
        <span>Title</span>
        <span>Author</span>
        <span>Status</span>
        <span>Checks</span>
      </div>

      {/* PR rows */}
      <div className="space-y-1">
        {filteredPrs.length > 0 ? (
          filteredPrs.map((pr) => (
            <PrRow
              key={pr.number}
              pr={pr}
              isNextToMerge={pr.number === nextToMergeNumber}
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
