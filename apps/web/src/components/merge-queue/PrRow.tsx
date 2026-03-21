import { formatRelative } from '@/utils/dateFormat';
import { getPrStatus } from '@/utils/mergeQueueStatus';
import type { MergeQueuePr, PrFilterStatus } from '@/types';

interface PrRowProps {
  pr: MergeQueuePr;
  isNextToMerge: boolean;
}

const ACCENT_SHADOW: Record<PrFilterStatus, string> = {
  mergeable: 'shadow-[inset_3px_0_0_theme(colors.green.500)]',
  pending: 'shadow-[inset_3px_0_0_theme(colors.amber.500)]',
  blocked: 'shadow-[inset_3px_0_0_theme(colors.red.500)]',
};

const STATUS_BADGE: Record<PrFilterStatus, string> = {
  mergeable: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const CONFLICT_LABEL: Record<string, string> = {
  clean: 'No conflicts',
  conflicting: 'Conflicts',
  unknown: 'Checking…',
};

export function PrRow({ pr, isNextToMerge }: PrRowProps): React.JSX.Element {
  const status = getPrStatus(pr);
  const conflictLabel = pr.mergeConflictStatus !== null
    ? CONFLICT_LABEL[pr.mergeConflictStatus] ?? 'Unknown'
    : 'Unknown';

  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${ACCENT_SHADOW[status]} ${
        !pr.authorIsEligible ? 'opacity-50' : ''
      }`}
    >
      {/* Desktop layout */}
      <div className="hidden items-center gap-2 lg:grid lg:grid-cols-[60px_1fr_120px_100px_100px]">
        <div className="flex items-center gap-1">
          {isNextToMerge ? <span className="h-2 w-2 rounded-full bg-blue-500" /> : null}
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-blue-600 hover:underline dark:text-blue-400"
          >
            #{String(pr.number)}
          </a>
        </div>
        <div className="min-w-0">
          <p
            className="overflow-hidden text-ellipsis whitespace-nowrap text-slate-900 dark:text-slate-100"
            title={!pr.authorIsEligible ? `Not eligible \u2014 authored by ${pr.author ?? 'unknown'}` : pr.title}
          >
            {pr.title}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Created {formatRelative(pr.createdAt)}</p>
        </div>
        <span className="text-xs text-slate-600 dark:text-slate-400">{pr.author ?? 'unknown'}</span>
        <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status]}`}>
          {status}
        </span>
        <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status]}`}>
          {conflictLabel}
        </span>
      </div>

      {/* Mobile layout */}
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex items-center gap-2">
          {isNextToMerge ? <span className="h-2 w-2 rounded-full bg-blue-500" /> : null}
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-blue-600 hover:underline dark:text-blue-400"
          >
            #{String(pr.number)}
          </a>
          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-slate-900 dark:text-slate-100">
            {pr.title}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>{pr.author ?? 'unknown'}</span>
          <span>&middot;</span>
          <span>Created {formatRelative(pr.createdAt)}</span>
        </div>
        <div className="flex gap-2">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status]}`}>
            {status}
          </span>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[status]}`}>
            {conflictLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
