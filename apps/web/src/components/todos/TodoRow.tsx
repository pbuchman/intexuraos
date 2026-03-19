import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { PriorityBadge, StatusBadge, getAccentShadow } from '@/components/todos/shared.js';
import { formatRelative } from '@/utils/dateFormat.js';
import type { Todo } from '@/types';

interface TodoRowProps {
  todo: Todo;
  onSelect: (todo: Todo) => void;
  onDelete: (todoId: string) => Promise<void>;
}

export function TodoRow({ todo, onSelect, onDelete }: TodoRowProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await onDelete(todo.id);
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div
      className={`group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800 ${getAccentShadow(todo.status)}`}
      onClick={(): void => { onSelect(todo); }}
    >
      <div className="grid grid-cols-[1fr_auto_auto_140px_80px] items-center gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">{todo.title}</p>
        </div>
        <PriorityBadge priority={todo.priority} />
        <StatusBadge status={todo.status} />
        <span className="text-xs text-slate-400 dark:text-slate-500">{formatRelative(todo.updatedAt)}</span>
        <div className="flex items-center justify-end">
          <button
            onClick={(e): void => { e.stopPropagation(); setShowDeleteConfirm(true); }}
            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
          onClick={(e): void => { e.stopPropagation(); }}
        >
          <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
            <button
              onClick={(): void => { setShowDeleteConfirm(false); }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={(): void => { void handleDelete(); }}
              disabled={deleting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
