import { useEffect } from 'react';
import type { Command, CommandType } from '@/types';
import {
  Bell,
  Calendar,
  Clock,
  FileText,
  HelpCircle,
  Link,
  ListTodo,
  Mic,
  MessageSquare,
  Search,
  X,
} from 'lucide-react';

interface CommandDetailModalProps {
  command: Command;
  onClose: () => void;
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

export function CommandDetailModal({
  command,
  onClose,
}: CommandDetailModalProps): React.JSX.Element {
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

  const isVoice = command.sourceType === 'whatsapp_voice';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-slate-100 p-2">
              {isVoice ? (
                <Mic className="h-5 w-5 text-purple-500" />
              ) : (
                <MessageSquare className="h-5 w-5 text-blue-500" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {isVoice ? 'Voice Command' : 'Text Command'}
              </h2>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-500">
                {command.classification !== undefined && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    {getTypeIcon(command.classification.type)}
                    {getTypeLabel(command.classification.type)}
                  </span>
                )}
                <span>{command.status}</span>
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
          {/* Command text */}
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Command Text
            </h3>
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{command.text}</div>
          </div>

          {/* Classification confidence */}
          {command.classification?.confidence !== undefined && (
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Classification Confidence
              </h3>
              <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600">
                {String(Math.round(command.classification.confidence * 100))}% confident
              </div>
            </div>
          )}

          {/* Classification reasoning */}
          {command.classification?.reasoning !== undefined && (
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
              <span>Created {formatDate(command.createdAt)}</span>
            </div>
            {command.updatedAt !== command.createdAt && (
              <div className="flex items-center gap-1">
                <span>Updated {formatDate(command.updatedAt)}</span>
              </div>
            )}
          </div>

          {/* Status badge */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-sm font-medium text-slate-600">
              Status:{' '}
              <span
                className={
                  command.status === 'classified'
                    ? 'text-green-600'
                    : command.status === 'pending_classification' || command.status === 'received'
                      ? 'text-amber-600'
                      : command.status === 'failed'
                        ? 'text-red-600'
                        : 'text-slate-600'
                }
              >
                {command.status.charAt(0).toUpperCase() + command.status.slice(1).replace('_', ' ')}
              </span>
            </span>
          </div>
        </div>

        {/* Footer - Close button */}
        <div className="flex items-center justify-end border-t border-slate-200 p-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
