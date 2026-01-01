import { useEffect } from 'react';
import type { Action, Command, CommandType } from '@/types';
import {
  Bell,
  Calendar,
  Clock,
  FileText,
  HelpCircle,
  Link,
  ListTodo,
  Loader2,
  Play,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';

interface ActionDetailModalProps {
  action: Action;
  command: Command | undefined;
  onClose: () => void;
  onProceed: () => void;
  onReject: () => void;
  onDelete: () => void;
  isUpdating: boolean;
  isDeleting: boolean;
}

function getTypeIcon(type: CommandType): React.JSX.Element {
  const iconClass = 'h-5 w-5';
  switch (type) {
    case 'todo':
      return <ListTodo className={iconClass} />;
    case 'research':
      return <Search className={iconClass} />;
    case 'note':
      return <FileText className={iconClass} />;
    case 'link':
      return <Link className={iconClass} />;
    case 'calendar':
      return <Calendar className={iconClass} />;
    case 'reminder':
      return <Bell className={iconClass} />;
    default:
      return <HelpCircle className={iconClass} />;
  }
}

function getTypeLabel(type: CommandType): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ActionDetailModal({
  action,
  command,
  onClose,
  onProceed,
  onReject,
  onDelete,
  isUpdating,
  isDeleting,
}: ActionDetailModalProps): React.JSX.Element {
  const isPending = action.status === 'pending';

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return (): void => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-slate-100 p-2">{getTypeIcon(action.type)}</div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{action.title}</h2>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                  {getTypeLabel(action.type)}
                </span>
                <span>{String(Math.round(action.confidence * 100))}% confidence</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-4">
          {/* Original command text */}
          {command !== undefined && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Original Command
              </h3>
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                {command.text}
              </div>
            </div>
          )}

          {/* Classification reasoning */}
          {command?.classification?.reasoning !== undefined && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Classification Reasoning
              </h3>
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
                {command.classification.reasoning}
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              <span>Created {formatDate(action.createdAt)}</span>
            </div>
            {action.updatedAt !== action.createdAt && (
              <div className="flex items-center gap-1">
                <span>Updated {formatDate(action.updatedAt)}</span>
              </div>
            )}
          </div>

          {/* Status badge for non-pending actions */}
          {!isPending && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-sm font-medium text-slate-600">
                Status:{' '}
                <span
                  className={
                    action.status === 'completed'
                      ? 'text-green-600'
                      : action.status === 'processing'
                        ? 'text-blue-600'
                        : action.status === 'failed' || action.status === 'rejected'
                          ? 'text-red-600'
                          : 'text-slate-600'
                  }
                >
                  {action.status.charAt(0).toUpperCase() + action.status.slice(1)}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Actions - only for pending */}
        {isPending && (
          <div className="flex items-center justify-between border-t border-slate-200 p-4">
            <button
              onClick={onDelete}
              disabled={isUpdating || isDeleting}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete
            </button>
            <div className="flex gap-2">
              <button
                onClick={onReject}
                disabled={isUpdating || isDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </button>
              <button
                onClick={onProceed}
                disabled={isUpdating || isDeleting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Proceed
              </button>
            </div>
          </div>
        )}

        {/* Close button for non-pending */}
        {!isPending && (
          <div className="flex justify-end border-t border-slate-200 p-4">
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
