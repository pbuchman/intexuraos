import { AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface RegenerateConfirmModalProps {
  readonly isOpen: boolean;
  readonly currentGeneration: number;
  readonly date: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
}

export function RegenerateConfirmModal({
  isOpen,
  currentGeneration,
  date,
  onConfirm,
  onCancel,
  busy,
}: RegenerateConfirmModalProps): React.JSX.Element {
  return (
    <Modal
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open && !busy) onCancel();
      }}
      title="Regenerate digest?"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="mb-3 flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Regenerate digest?
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            The current digest for {date} is generation{' '}
            <span className="font-semibold">{String(currentGeneration)}</span>.
            A new run will create generation{' '}
            <span className="font-semibold">{String(currentGeneration + 1)}</span>{' '}
            and replace the current content.
          </p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Generating...' : 'Regenerate'}
        </button>
      </div>
    </Modal>
  );
}
