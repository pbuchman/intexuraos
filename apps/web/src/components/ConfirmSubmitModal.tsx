import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import type { CodeTaskWorkerType } from '@intexuraos/code-task-domain/worker-types';
import { DEFAULT_TIMEOUT_HOURS } from '@intexuraos/code-task-domain/timeout';
import type { TaskMode } from '@/types';
import { formatSchedulePreview } from '@/utils/scheduledDispatch';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';
import { WORKER_TYPE_LABELS } from './workers/shared.js';

const TASK_MODE_LABELS: Record<TaskMode, string> = {
  planning: 'Planning',
  execution: 'Execution',
};

interface ConfirmSubmitModalProps {
  isOpen: boolean;
  taskTitle: string;
  workerType: CodeTaskWorkerType;
  taskMode: TaskMode;
  schedule?: {
    localDateTime: string;
    timezone: string;
    notBeforeAt: string;
  };
  /**
   * Selected per-task timeout in hours. Rendered as an extra info row only
   * when it differs from `DEFAULT_TIMEOUT_HOURS`. INT-1585.
   */
  timeoutHours?: number;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ConfirmSubmitModal({
  isOpen,
  taskTitle,
  workerType,
  taskMode,
  schedule,
  timeoutHours,
  onConfirm,
  onCancel,
}: ConfirmSubmitModalProps): React.JSX.Element | null {
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleConfirm = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      await onConfirm();
    } catch (err) {
      setIsSubmitting(false);
      // Close modal and let parent handle error display
      onCancel();
      // Re-throw so parent can catch
      throw err;
    }
  };

  const workerTypeLabel = WORKER_TYPE_LABELS[workerType];

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open): void => {
        if (!open && !isSubmitting) onCancel();
      }}
      title="Confirm Task Submission"
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800"
    >
      {isSubmitting ? (
        <div className="flex flex-col items-center justify-center p-12">
          <Loader2 className="h-12 w-12 animate-spin text-blue-500" />
          <p className="mt-4 text-lg font-medium text-slate-700 dark:text-slate-200">
            Submitting task...
          </p>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4 dark:border-slate-700">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-blue-100 p-2 dark:bg-blue-900/50">
                <Send className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Confirm Task Submission
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Review the details before submitting
                </p>
              </div>
            </div>
            <button
              onClick={onCancel}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="text-slate-700 dark:text-slate-200">
              Do you want to submit{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                &quot;{taskTitle}&quot;
              </span>{' '}
              as{' '}
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {workerTypeLabel}
              </span>
              {' '}in{' '}
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                {TASK_MODE_LABELS[taskMode]}
              </span>
              {' '}mode?
            </p>
            {schedule !== undefined ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {formatSchedulePreview(schedule.notBeforeAt, schedule.timezone)}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Added to queue immediately
                </p>
              </div>
            ) : null}
            {timeoutHours !== undefined && timeoutHours !== DEFAULT_TIMEOUT_HOURS ? (
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
                Custom timeout:{' '}
                <span className="font-semibold">
                  {String(timeoutHours)} {timeoutHours === 1 ? 'hour' : 'hours'}
                </span>
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={(): void => {
                void handleConfirm();
              }}
            >
              <Send className="mr-2 h-4 w-4" />
              Submit Task
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
