import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { PruneCandidateResponse } from '@/services/linearApi';
import { CATEGORY_CONFIG, scoreColor } from './shared';

interface PruneCandidateRowProps {
  candidate: PruneCandidateResponse;
  isSelected: boolean;
  onToggleSelection: (id: string) => void;
  onDismiss: (id: string) => void;
}

export function PruneCandidateRow({
  candidate,
  isSelected,
  onToggleSelection,
  onDismiss,
}: PruneCandidateRowProps): React.JSX.Element {
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const cfg = CATEGORY_CONFIG[candidate.category];

  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600">
      {/* Desktop grid layout */}
      <div className="hidden grid-cols-[28px_1fr_80px_120px_100px_36px] items-center gap-2 lg:grid">
        {/* Checkbox */}
        <div className="flex items-center justify-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e): void => {
              e.stopPropagation();
              onToggleSelection(candidate.id);
            }}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 accent-red-600 dark:border-slate-600"
            aria-label={
              isSelected
                ? `Deselect ${candidate.identifier}`
                : `Select ${candidate.identifier}`
            }
          />
        </div>

        {/* Issue identifier + title */}
        <div className="flex min-w-0 items-center gap-3">
          <a
            href={`https://linear.app/issue/${candidate.identifier}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1 font-mono text-sm font-semibold text-blue-600 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {candidate.identifier}
            <ExternalLink className="h-3 w-3" />
          </a>
          <p className="truncate text-sm text-slate-700 dark:text-slate-300">
            {candidate.title}
          </p>
        </div>

        {/* Score */}
        <div className="text-center">
          <span
            className={`text-sm font-bold tabular-nums ${scoreColor(candidate.score)}`}
            title="Deletion confidence score"
          >
            {candidate.score}
          </span>
        </div>

        {/* Category badge */}
        <div className="flex justify-center">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badgeClass}`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
            {cfg.label}
          </span>
        </div>

        {/* Reason (truncated) */}
        <div className="truncate text-xs text-slate-500 dark:text-slate-400" title={candidate.reason}>
          {candidate.reason}
        </div>

        {/* Dismiss button (client-side only — no per-item delete API) */}
        <div className="flex justify-center">
          <button
            onClick={(): void => { setShowDismissConfirm(true); }}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            aria-label={`Dismiss ${candidate.identifier} from view`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile stacked layout */}
      <div className="flex flex-col gap-2 lg:hidden">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e): void => {
              e.stopPropagation();
              onToggleSelection(candidate.id);
            }}
            className="mt-1 h-4 w-4 cursor-pointer rounded border-slate-300 accent-red-600 dark:border-slate-600"
            aria-label={
              isSelected
                ? `Deselect ${candidate.identifier}`
                : `Select ${candidate.identifier}`
            }
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <a
                href={`https://linear.app/issue/${candidate.identifier}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex shrink-0 items-center gap-1 font-mono text-sm font-semibold text-blue-600 dark:text-blue-400"
              >
                {candidate.identifier}
                <ExternalLink className="h-3 w-3" />
              </a>
              <span
                className={`text-sm font-bold tabular-nums ${scoreColor(candidate.score)}`}
              >
                {candidate.score}
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.badgeClass}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dotClass}`} />
                {cfg.label}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-slate-700 dark:text-slate-300">
              {candidate.title}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {candidate.reason}
            </p>
          </div>
          <button
            onClick={(): void => { setShowDismissConfirm(true); }}
            className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
            aria-label={`Dismiss ${candidate.identifier} from view`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Inline dismiss confirmation overlay (IssueGroupRow pattern) */}
      {showDismissConfirm ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80">
          <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Remove {candidate.identifier} from view?
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => { setShowDismissConfirm(false); }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => { onDismiss(candidate.id); }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
