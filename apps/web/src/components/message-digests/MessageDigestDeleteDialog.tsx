import { AlertTriangle, CheckCircle2, LoaderCircle, Trash2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { Modal } from '@/components/ui/Modal';
import { useMessageDigestDeletion } from '@/hooks/useMessageDigests';
import type { MessageDigestErasureStage } from '@/types/messageDigests';

interface MessageDigestDeleteDialogProps {
  definitionId: string;
  definitionName: string;
  erasureRequestId: string | null;
  open: boolean;
  returnFocusRef: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

const STAGE_LABELS: Record<MessageDigestErasureStage, string> = {
  quiescing: 'Stopping new digest work',
  runs: 'Removing digest history',
  outbox: 'Removing pending delivery records',
  state: 'Removing digest state',
  definition: 'Removing digest settings',
  legacy: 'Removing migrated legacy history',
  completed: 'Deletion complete',
};

export function MessageDigestDeleteDialog({
  definitionId,
  definitionName,
  erasureRequestId,
  open,
  returnFocusRef,
  onOpenChange,
  onDeleted,
}: MessageDigestDeleteDialogProps): React.JSX.Element {
  const deletion = useMessageDigestDeletion(definitionId, { erasureRequestId });
  const reportedCompletionRef = useRef<string | null>(null);
  const pending = deletion.isDeleting || deletion.isRecovering;
  const effectiveOpen = open || pending;

  useEffect(() => {
    const erasure = deletion.erasure;
    if (erasure?.status !== 'completed') return;
    if (reportedCompletionRef.current === erasure.erasureRequestId) return;
    reportedCompletionRef.current = erasure.erasureRequestId;
    onDeleted();
  }, [deletion.erasure, onDeleted]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen && pending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Modal
      open={effectiveOpen}
      onOpenChange={handleOpenChange}
      title={pending ? 'Deleting Message Digest' : 'Delete Message Digest?'}
      description={
        pending
          ? 'Cleanup continues safely if this page reloads.'
          : 'This permanently removes this digest and its generated history.'
      }
      size="md"
      contentClassName="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800"
      returnFocusRef={returnFocusRef}
    >
      {pending ? (
        <PendingDeletion
          isRecovering={deletion.isRecovering}
          stage={deletion.erasure?.stage ?? null}
          error={deletion.error}
          onRetry={deletion.retry}
        />
      ) : (
        <DeletionConfirmation
          definitionName={definitionName}
          onCancel={(): void => {
            onOpenChange(false);
          }}
          onDelete={deletion.startDeletion}
        />
      )}
    </Modal>
  );
}

function DeletionConfirmation({
  definitionName,
  onCancel,
  onDelete,
}: {
  definitionName: string;
  onCancel: () => void;
  onDelete: () => Promise<unknown>;
}): React.JSX.Element {
  return (
    <div className="mt-5">
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">
        <p className="flex items-start gap-2 font-semibold">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words">{definitionName}</span>
        </p>
        <p className="mt-2 leading-6">
          Generated summaries, run history, and pending delivery records are removed. The original
          WhatsApp conversation is never changed or deleted.
        </p>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={(): void => {
            void onDelete();
          }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          Delete digest
        </button>
      </div>
    </div>
  );
}

function PendingDeletion({
  isRecovering,
  stage,
  error,
  onRetry,
}: {
  isRecovering: boolean;
  stage: MessageDigestErasureStage | null;
  error: string | null;
  onRetry: () => Promise<unknown>;
}): React.JSX.Element {
  return (
    <div className="mt-5">
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"
      >
        <p className="flex items-center gap-2 font-semibold">
          {error === null ? (
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
          )}
          {isRecovering ? 'Restoring deletion progress…' : 'Deletion is in progress'}
        </p>
        <p className="mt-2 flex items-center gap-2 text-blue-800 dark:text-blue-200">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
          {stage === null ? 'Preparing safe cleanup' : STAGE_LABELS[stage]}
        </p>
      </div>

      {error !== null ? (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={(): void => {
              void onRetry();
            }}
            className="mt-2 inline-flex min-h-11 items-center rounded-lg font-semibold underline focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            Retry deletion
          </button>
        </div>
      ) : null}

      <button
        type="button"
        disabled
        className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-200 px-4 text-sm font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300"
      >
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
        />
        Deleting…
      </button>
    </div>
  );
}
