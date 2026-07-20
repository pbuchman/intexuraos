import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export function ConversationAssistantDeleteDialog({
  open,
  title,
  deleting,
  error,
  resumePending = false,
  returnFocusTo,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  deleting: boolean;
  error: string | null;
  resumePending?: boolean;
  returnFocusTo: HTMLButtonElement | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}): React.JSX.Element {
  const closeAndRestoreFocus = (): void => {
    onOpenChange(false);
    window.setTimeout(() => {
      if (returnFocusTo?.isConnected === true) returnFocusTo.focus();
    }, 0);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen): void => {
        if (deleting) return;
        if (nextOpen) {
          onOpenChange(true);
          return;
        }
        closeAndRestoreFocus();
      }}
      title={resumePending ? 'Finish deletion?' : 'Delete analysis?'}
      description={
        resumePending
          ? `The previous deletion of “${title}” was interrupted. Finish removing its remaining analysis data.`
          : `This permanently removes “${title}”, its frozen context, questions and answers.`
      }
      size="sm"
    >
      <div
        role="note"
        aria-label="WhatsApp data safety"
        className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Original WhatsApp conversation stays untouched.</span>
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        This action cannot be undone.
      </p>
      {error !== null ? (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          disabled={deleting}
          onClick={(): void => {
            closeAndRestoreFocus();
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          className="min-h-11"
          isLoading={deleting}
          loadingText={resumePending ? 'Finishing…' : 'Deleting…'}
          onClick={(): void => {
            void onConfirm();
          }}
        >
          {resumePending ? 'Finish deletion' : 'Delete analysis'}
        </Button>
      </div>
    </Modal>
  );
}
