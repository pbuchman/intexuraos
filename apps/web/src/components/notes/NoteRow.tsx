import { useState } from 'react';
import { Tag, Trash2 } from 'lucide-react';
import { formatRelative } from '@/utils/dateFormat.js';
import { truncateContent } from './shared.js';
import type { Note } from '@/types';

interface NoteRowProps {
  note: Note;
  onSelect: (note: Note) => void;
  onDelete: (noteId: string) => Promise<void>;
}

export function NoteRow({ note, onSelect, onDelete }: NoteRowProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(note.id);
      setShowDeleteConfirm(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
      onClick={(): void => { onSelect(note); }}
    >
      <div className="grid grid-cols-[1fr_auto_140px_60px] items-center gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-slate-100">{note.title}</p>
          <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
            {truncateContent(note.content)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {note.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
          {note.tags.length > 2 ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">+{note.tags.length - 2}</span>
          ) : null}
        </div>
        <span className="text-xs text-slate-400 dark:text-slate-500">{formatRelative(note.updatedAt)}</span>
        <div className="flex items-center justify-end">
          <button
            onClick={(e): void => { e.stopPropagation(); setShowDeleteConfirm(true); setDeleteError(null); }}
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
          <div className="flex flex-col items-center gap-2 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
            {deleteError !== null ? (
              <p className="text-xs text-red-600 dark:text-red-400">{deleteError}</p>
            ) : null}
            <div className="flex items-center gap-3">
              <button
                onClick={(): void => { setShowDeleteConfirm(false); setDeleteError(null); }}
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
        </div>
      ) : null}
    </div>
  );
}
