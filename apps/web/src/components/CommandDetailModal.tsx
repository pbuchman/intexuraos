import type { Command, CommandType } from '@/types';
import { formatDateTime } from '@/utils/dateFormat';
import {
  Bell,
  Calendar,
  Clock,
  FileText,
  HelpCircle,
  Link,
  Mic,
  MessageSquare,
  Search,
  X,
} from 'lucide-react';
import { Modal } from './ui/Modal.js';

interface CommandDetailModalProps {
  command: Command;
  onClose: () => void;
}

function getTypeIcon(type: CommandType): React.JSX.Element {
  const iconClass = 'h-5 w-5';
  switch (type) {
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

export function CommandDetailModal({
  command,
  onClose,
}: CommandDetailModalProps): React.JSX.Element {
  const isVoice = command.sourceType === 'whatsapp_voice';
  const headerTitle = isVoice ? 'Voice Command' : 'Text Command';

  return (
    <Modal
      open
      onOpenChange={(open): void => {
        if (!open) onClose();
      }}
      title={headerTitle}
      hideTitle
      padded={false}
      contentClassName="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl dark:bg-slate-800"
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between border-b border-slate-200 p-4 dark:border-slate-700">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-slate-100 p-2 dark:bg-slate-700">
            {isVoice ? (
              <Mic className="h-5 w-5 text-purple-500" />
            ) : (
              <MessageSquare className="h-5 w-5 text-blue-500" />
            )}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {headerTitle}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              {command.classification !== undefined && (
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300">
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
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Command text */}
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Command Text
          </h3>
          <div className="break-words rounded-lg bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-700 dark:text-slate-300">
            {command.text}
          </div>
        </div>

        {/* Classification confidence */}
        {command.classification?.confidence !== undefined && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Classification Confidence
            </h3>
            <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {String(Math.round(command.classification.confidence * 100))}% confident
            </div>
          </div>
        )}

        {/* Classification reasoning */}
        {command.classification?.reasoning !== undefined && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Classification Reasoning
            </h3>
            <div className="break-words rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {command.classification.reasoning}
            </div>
          </div>
        )}

        {/* Timestamps */}
        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            <span>Created {formatDateTime(command.createdAt)}</span>
          </div>
          {command.updatedAt !== command.createdAt && (
            <div className="flex items-center gap-1">
              <span>Updated {formatDateTime(command.updatedAt)}</span>
            </div>
          )}
        </div>

        {/* Status badge */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-700">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
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
      <div className="flex shrink-0 items-center justify-end border-t border-slate-200 p-4 dark:border-slate-700">
        <button
          onClick={onClose}
          className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
