import {
  Archive,
  CheckCircle,
  Clock,
  Cog,
  FileText,
  HelpCircle,
  Link,
  ListTodo,
  Loader2,
  MessageSquare,
  Mic,
  Bell,
  Calendar,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { Command, CommandType } from '@/types';
import { formatDate } from '@/utils/dateFormat';

function getTypeIcon(type: CommandType): React.JSX.Element {
  const iconClass = 'h-4 w-4';
  switch (type) {
    case 'todo':
      return <ListTodo className={iconClass} />;
    case 'research':
      return <FileText className={iconClass} />;
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

function getStatusIcon(status: string): React.JSX.Element {
  const iconClass = 'h-4 w-4';
  switch (status) {
    case 'completed':
    case 'classified':
      return <CheckCircle className={`${iconClass} text-green-500`} />;
    case 'pending':
    case 'received':
    case 'pending_classification':
      return <Clock className={`${iconClass} text-amber-500`} />;
    case 'processing':
      return <Cog className={`${iconClass} text-blue-500`} />;
    case 'failed':
    case 'rejected':
      return <XCircle className={`${iconClass} text-red-500`} />;
    case 'archived':
      return <Archive className={`${iconClass} text-slate-400`} />;
    default:
      return <HelpCircle className={`${iconClass} text-slate-400`} />;
  }
}

interface CommandItemProps {
  command: Command;
  onClick: () => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  isDeleting: boolean;
  isArchiving: boolean;
}

export function CommandItem({
  command,
  onClick,
  onDelete,
  onArchive,
  isDeleting,
  isArchiving,
}: CommandItemProps): React.JSX.Element {
  const isVoice = command.sourceType === 'whatsapp_voice';
  const deletableStatuses = ['received', 'pending_classification', 'failed'];
  const canDelete = deletableStatuses.includes(command.status);
  const canArchive = command.status === 'classified';

  return (
    <div
      className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e): void => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {isVoice ? (
            <Mic className="h-5 w-5 text-purple-500" />
          ) : (
            <MessageSquare className="h-5 w-5 text-blue-500" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 break-words text-sm text-slate-800 dark:text-slate-200">{command.text}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {command.classification !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                {getTypeIcon(command.classification.type)}
                {getTypeLabel(command.classification.type)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              {getStatusIcon(command.status)}
              {command.status}
            </span>
            <span>{formatDate(command.createdAt)}</span>
          </div>
        </div>
        <div
          className="flex shrink-0 gap-2"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          {canDelete && (
            <button
              onClick={(): void => {
                onDelete(command.id);
              }}
              disabled={isDeleting}
              className="rounded p-2.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/30"
              title="Delete command"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          )}
          {canArchive && (
            <button
              onClick={(): void => {
                onArchive(command.id);
              }}
              disabled={isArchiving}
              className="rounded p-2.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-50 dark:hover:bg-amber-900/30"
              title="Archive command"
            >
              {isArchiving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
