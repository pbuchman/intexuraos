import { Trash2 } from 'lucide-react';
import { Button } from '@/components';
import { Modal } from '@/components/ui/Modal';

interface DiscardDraftModalProps {
  open: boolean;
  discarding: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DiscardDraftModal(props: DiscardDraftModalProps): React.JSX.Element | null {
  const { open, discarding, onCancel, onConfirm } = props;

  return (
    <Modal
      open={open}
      onOpenChange={(o): void => {
        if (!o && !discarding) onCancel();
      }}
      title="Discard Draft?"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-slate-800"
    >
      <div className="mb-4 flex items-start gap-3">
        <Trash2 className="mt-0.5 h-6 w-6 shrink-0 text-red-500 dark:text-red-400" />
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Discard Draft?
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            This will permanently delete this draft. This action cannot be undone.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={discarding}>
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={discarding}
          isLoading={discarding}
        >
          Discard
        </Button>
      </div>
    </Modal>
  );
}
