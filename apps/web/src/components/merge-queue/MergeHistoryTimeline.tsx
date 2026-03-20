import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatRelative } from '@/utils/dateFormat';
import type { MergedPrEntry } from '@/types';

interface MergeHistoryTimelineProps {
  mergedPrs: MergedPrEntry[];
}

export function MergeHistoryTimeline({ mergedPrs }: MergeHistoryTimelineProps): React.JSX.Element | null {
  const [isExpanded, setIsExpanded] = useState(true);

  if (mergedPrs.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      <button
        onClick={(): void => { setIsExpanded(!isExpanded); }}
        className="flex w-full items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300"
      >
        <span>Merge History</span>
        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
          ({String(mergedPrs.length)} merged)
        </span>
        {isExpanded ? (
          <ChevronUp className="ml-auto h-4 w-4" />
        ) : (
          <ChevronDown className="ml-auto h-4 w-4" />
        )}
      </button>

      {isExpanded ? (
        <div className="mt-3 border-l-2 border-slate-300 pl-4 dark:border-zinc-700">
          {mergedPrs.map((pr) => (
            <div key={pr.prNumber} className="relative mb-3 last:mb-0">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <div className="text-sm">
                <span className="font-mono text-blue-600 dark:text-blue-400">
                  #{String(pr.prNumber)}
                </span>
                <span className="mx-1 text-slate-400">&mdash;</span>
                <span className="text-slate-900 dark:text-slate-100">{pr.title}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Merged {formatRelative(pr.mergedAt)} &middot; {pr.author}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
