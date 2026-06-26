import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

export type ConflictReason = 'duplicate' | 'active';

interface TaskConflictModalProps {
  isOpen: boolean;
  taskId: string;
  reason: ConflictReason;
  onClose: () => void;
  onNavigateToTask: (taskId: string) => void;
}

const CONFLICT_MESSAGES: Record<
  ConflictReason,
  { title: string; description: string }
> = {
  duplicate: {
    title: 'Similar Task Detected',
    description:
      'A similar task was submitted in the last 5 minutes. You can view the existing task or close this to continue.',
  },
  active: {
    title: 'Active Task Exists',
    description:
      'An active task already exists for this Linear issue. You can view the existing task or close this to continue.',
  },
};

export function TaskConflictModal({
  isOpen,
  taskId,
  reason,
  onClose,
  onNavigateToTask,
}: TaskConflictModalProps): React.JSX.Element {
  const messages = CONFLICT_MESSAGES[reason];

  const handleNavigate = (): void => {
    onNavigateToTask(taskId);
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title={messages.title}
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800"
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-amber-100 p-2 dark:bg-amber-900/50">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {messages.title}
            </h2>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
          <p className="text-sm text-amber-800 dark:text-amber-300">{messages.description}</p>
          <p className="mt-2 truncate text-xs font-mono text-amber-700 dark:text-amber-400">
            Task ID: {taskId}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button variant="primary" onClick={handleNavigate}>
          View Existing Task
        </Button>
      </div>
    </Modal>
  );
}
