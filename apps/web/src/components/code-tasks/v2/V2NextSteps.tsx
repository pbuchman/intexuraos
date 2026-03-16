import {
  ChevronDown,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import { GitHubButton, LinearButton, WORKER_TYPES, WORKER_TYPE_LABELS } from './shared.js';
import type { WorkerType } from './shared.js';

interface V2NextStepsProps {
  isImplementable: boolean;
  implementing: boolean;
  implementError: string | null;
  implementationTaskId?: string;
  selectedWorkerType: WorkerType;
  originalWorkerType: WorkerType;
  showDropdown: boolean;
  onToggleDropdown: () => void;
  onSelectWorkerType: (type: WorkerType) => void;
  onImplement: () => void;
  prUrl?: string;
  linearIssueUrl?: string;
}

export function V2NextSteps({
  isImplementable,
  implementing,
  implementError,
  implementationTaskId,
  selectedWorkerType,
  originalWorkerType,
  showDropdown,
  onToggleDropdown,
  onSelectWorkerType,
  onImplement,
  prUrl,
  linearIssueUrl,
}: V2NextStepsProps): React.JSX.Element | null {
  if (!isImplementable && implementationTaskId === undefined && implementError === null) return null;

  return (
    <div className="mt-4">
      {implementationTaskId !== undefined ? (
        <div className="flex items-center gap-3">
          <a
            href={`/#/code-tasks/${implementationTaskId}`}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
          >
            <Play className="h-4 w-4" />
            View Implementation
          </a>
          {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
          {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
        </div>
      ) : isImplementable ? (
        <div className="relative flex items-center gap-3">
          <div className="relative flex">
            <button
              type="button"
              onClick={onImplement}
              disabled={implementing}
              className="flex items-center gap-2 rounded-l-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-600/30 dark:bg-emerald-500/15 dark:text-emerald-400 dark:hover:bg-emerald-500/25"
            >
              {implementing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="hidden sm:inline">Implement</span>
              <span className="hidden sm:inline font-normal text-emerald-500 dark:text-emerald-400/70">{'· '}{WORKER_TYPE_LABELS[selectedWorkerType]}</span>
            </button>
            <div className="w-px bg-emerald-300 dark:bg-emerald-500/20" />
            <button
              type="button"
              onClick={onToggleDropdown}
              disabled={implementing}
              className="flex items-center rounded-r-lg border border-l-0 border-emerald-300 bg-emerald-50 px-2.5 py-2 text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-600/30 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
            </button>
            {showDropdown ? (
              <div className="absolute bottom-full left-0 z-10 mb-2 w-48 rounded-lg border border-slate-200 bg-white py-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-800">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Model</div>
                {WORKER_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={(): void => { onSelectWorkerType(type); }}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-700 ${
                      selectedWorkerType === type ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                      selectedWorkerType === type ? 'border-emerald-600 dark:border-emerald-400' : 'border-slate-400 dark:border-slate-500'
                    }`}>
                      {selectedWorkerType === type ? <div className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" /> : null}
                    </div>
                    <span className="flex-1">{WORKER_TYPE_LABELS[type]}</span>
                    {type === originalWorkerType ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">plan</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
          {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
        </div>
      ) : null}
      {implementError !== null ? (
        <div className="mt-3 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-400">{implementError}</p>
        </div>
      ) : null}
    </div>
  );
}
