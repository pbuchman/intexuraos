import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useCodeTaskLogs } from '@/hooks/useCodeTaskLogs.js';
import { CodeTaskLogViewer } from '@/components/code-tasks/CodeTaskLogViewer.js';

interface CodeTaskLogsModalProps {
  taskId: string;
  onClose: () => void;
}

const ACTIVE_STATUSES = new Set(['queued', 'dispatched', 'running']);

export function CodeTaskLogsModal({ taskId, onClose }: CodeTaskLogsModalProps): React.JSX.Element {
  const { task, logs, loading, error, listenerHealthy } = useCodeTaskLogs(taskId);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return (): void => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const taskStatus = task?.status ?? 'implemented';
  const isActive = ACTIVE_STATUSES.has(taskStatus);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="code-task-logs-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <div>
            <h2 id="code-task-logs-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Task Logs
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {task !== null ? `Task ${task.id}` : `Task ${taskId}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex min-h-[240px] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Loading logs...
            </div>
          ) : error !== null ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
              {error}
            </div>
          ) : (
            <CodeTaskLogViewer
              logs={logs}
              isActive={isActive}
              listenerHealthy={listenerHealthy}
              taskStatus={taskStatus}
              readOnly
            />
          )}
        </div>

        <div className="flex shrink-0 justify-end border-t border-slate-200 p-4 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
