import {
  Archive,
  ChevronDown,
  Loader2,
  RotateCcw,
  StopCircle,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components';
import { GitHubButton, LinearButton, WORKER_TYPES, WORKER_TYPE_LABELS } from './shared.js';
import type { WorkerType } from './shared.js';

interface V2TaskActionsProps {
  isActive: boolean;
  cancelling: boolean;
  cancelError: string | null;
  onCancel: () => Promise<void>;
  isRetryable: boolean;
  retrying: boolean;
  retryError: string | null;
  selectedWorkerType: WorkerType;
  originalWorkerType: WorkerType;
  showDropdown: boolean;
  onToggleDropdown: () => void;
  onSelectWorkerType: (type: WorkerType) => void;
  onRetry: () => void;
  deleting: boolean;
  deleteError: string | null;
  showDeleteConfirm: boolean;
  onShowDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onConfirmDelete: () => void;
  isArchivable: boolean;
  archiving: boolean;
  archiveError: string | null;
  onArchive: () => void;
  prUrl?: string;
  linearIssueUrl?: string;
  linksInNextSteps: boolean;
}

export function V2TaskActions({
  isActive, cancelling, cancelError, onCancel,
  isRetryable, retrying, retryError,
  selectedWorkerType, originalWorkerType, showDropdown, onToggleDropdown, onSelectWorkerType,
  onRetry,
  deleting, deleteError, showDeleteConfirm,
  onShowDeleteConfirm, onCancelDeleteConfirm, onConfirmDelete,
  isArchivable, archiving, archiveError, onArchive,
  prUrl, linearIssueUrl, linksInNextSteps,
}: V2TaskActionsProps): React.JSX.Element | null {
  if (!isActive && !isRetryable && !isArchivable && cancelError === null && retryError === null && deleteError === null && archiveError === null && (linksInNextSteps || (prUrl === undefined && linearIssueUrl === undefined))) return null;

  const deleteConfirmBlock = (
    <div className="ml-auto flex items-center gap-3">
      <p className="text-sm text-red-700 dark:text-red-400">Delete this task permanently?</p>
      <Button
        variant="danger"
        size="sm"
        onClick={onConfirmDelete}
        disabled={deleting}
        isLoading={deleting}
        loadingText="Deleting..."
      >
        Delete
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onCancelDeleteConfirm}
        disabled={deleting}
      >
        Cancel
      </Button>
    </div>
  );

  const isBusy = archiving || deleting || retrying;

  const archiveDeleteButtons = (
    <>
      <button
        type="button"
        onClick={onArchive}
        disabled={isBusy}
        className="ml-auto flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-300 disabled:opacity-50"
      >
        {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
        <span className="hidden sm:inline">Archive</span>
      </button>
      <button
        type="button"
        onClick={onShowDeleteConfirm}
        disabled={isBusy}
        className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
        <span className="hidden sm:inline">Delete</span>
      </button>
    </>
  );

  const linkButtons = (
    <>
      {linearIssueUrl !== undefined ? <LinearButton href={linearIssueUrl} /> : null}
      {prUrl !== undefined ? <GitHubButton href={prUrl} /> : null}
    </>
  );

  return (
    <div className="mt-4 flex flex-wrap items-stretch gap-3">
      {isActive ? (
        <>
          <Button
            variant="danger"
            onClick={(): void => { void onCancel(); }}
            disabled={cancelling}
            isLoading={cancelling}
          >
            <StopCircle className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Cancel Task</span>
          </Button>
          {linkButtons}
        </>
      ) : null}
      {isRetryable ? (
        showDeleteConfirm ? deleteConfirmBlock : (
          <>
            <div className="relative flex">
              <button
                type="button"
                onClick={onRetry}
                disabled={retrying || deleting}
                className="flex items-center gap-2 rounded-l-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
              >
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                <span className="hidden sm:inline">Retry Task</span>
                <span className="hidden sm:inline font-normal text-blue-200">{'· '}{WORKER_TYPE_LABELS[selectedWorkerType]}</span>
              </button>
              <div className="w-px bg-blue-400/30" />
              <button
                type="button"
                onClick={onToggleDropdown}
                disabled={retrying || deleting}
                className="flex items-center rounded-r-lg bg-blue-600 px-2.5 py-2 text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
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
                        selectedWorkerType === type ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 ${
                        selectedWorkerType === type ? 'border-blue-600 dark:border-blue-400' : 'border-slate-400 dark:border-slate-500'
                      }`}>
                        {selectedWorkerType === type ? <div className="h-1.5 w-1.5 rounded-full bg-blue-600 dark:bg-blue-400" /> : null}
                      </div>
                      <span className="flex-1">{WORKER_TYPE_LABELS[type]}</span>
                      {type === originalWorkerType ? (
                        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">original</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {linkButtons}
            {archiveDeleteButtons}
          </>
        )
      ) : null}
      {isArchivable && !isRetryable ? (
        showDeleteConfirm ? deleteConfirmBlock : (
          <>
            {linkButtons}
            {archiveDeleteButtons}
          </>
        )
      ) : null}
      {!isActive && !isRetryable && !isArchivable && !linksInNextSteps ? linkButtons : null}
      {cancelError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{cancelError}</p>
      ) : null}
      {retryError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{retryError}</p>
      ) : null}
      {deleteError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{deleteError}</p>
      ) : null}
      {archiveError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{archiveError}</p>
      ) : null}
    </div>
  );
}
