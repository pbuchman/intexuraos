import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface BookmarkConflictModalProps {
  isOpen: boolean;
  url: string;
  onSkip: () => void;
  onUpdate: () => Promise<void>;
  onClose: () => void;
}

export function BookmarkConflictModal({
  isOpen,
  url,
  onSkip,
  onUpdate,
  onClose,
}: BookmarkConflictModalProps): React.JSX.Element | null {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleUpdate = async (): Promise<void> => {
    setIsUpdating(true);
    setUpdateError(null);
    try {
      await onUpdate();
      onClose();
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : 'Failed to update bookmark');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSkip = (): void => {
    onSkip();
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open && !isUpdating) onClose();
      }}
      title="Duplicate link detected"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800"
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-amber-100 p-2 dark:bg-amber-900/50">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Duplicate link detected</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              This link already exists in your bookmarks
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          aria-label="Close"
          disabled={isUpdating}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            You already have this link saved in your bookmarks. Would you like to skip this
            action or update the existing bookmark with fresh data?
          </p>
          <p className="mt-2 truncate text-xs font-mono text-amber-700 dark:text-amber-400">{url}</p>
        </div>

        {updateError !== null && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
            <p className="text-sm text-red-600 dark:text-red-400">{updateError}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
        <Button variant="secondary" onClick={handleSkip} disabled={isUpdating}>
          Skip
        </Button>
        <Button
          variant="primary"
          onClick={(): void => {
            void handleUpdate();
          }}
          disabled={isUpdating}
          isLoading={isUpdating}
        >
          {isUpdating ? 'Updating...' : 'Update with fresh data'}
        </Button>
      </div>
    </Modal>
  );
}
