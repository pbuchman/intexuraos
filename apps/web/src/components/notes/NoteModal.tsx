import { useState } from 'react';
import { Calendar, Edit2, Link2, RotateCcw, Tag, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Input } from '@/components';
import { handleBackdropClick } from './shared.js';
import { formatDate } from '@/utils/dateFormat';
import type { Note, UpdateNoteRequest } from '@/types';

interface NoteModalProps {
  note: Note;
  onClose: () => void;
  onUpdate: (request: UpdateNoteRequest) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function NoteModal({ note, onClose, onUpdate, onDelete }: NoteModalProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState(note.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await onUpdate({
        title,
        content,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== ''),
      });
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  const handleCancel = (): void => {
    setTitle(note.title);
    setContent(note.content);
    setTags(note.tags.join(', '));
    setIsEditing(false);
    setShowDeleteConfirm(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { handleBackdropClick(e, onClose); }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isEditing ? 'Edit Note' : 'View Note'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {isEditing ? (
            <div className="space-y-4">
              <Input
                label="Title"
                value={title}
                onChange={(e): void => {
                  setTitle(e.target.value);
                }}
              />
              <div className="space-y-1">
                <label htmlFor="content" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Content
                </label>
                <textarea
                  id="content"
                  value={content}
                  onChange={(e): void => {
                    setContent(e.target.value);
                  }}
                  rows={8}
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <Input
                label="Tags (comma separated)"
                value={tags}
                onChange={(e): void => {
                  setTags(e.target.value);
                }}
                placeholder="e.g., work, important, ideas"
              />
              {saveError !== null ? (
                <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{note.title}</h3>
              {note.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {note.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-800 dark:bg-blue-900/50 dark:text-blue-300"
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="prose prose-slate prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {note.content}
                </ReactMarkdown>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1" title="Created">
                  <Calendar className="h-3 w-3" />
                  {formatDate(note.createdAt)}
                </span>
                <span className="flex items-center gap-1" title="Updated">
                  <RotateCcw className="h-3 w-3" />
                  {formatDate(note.updatedAt)}
                </span>
                <span className="flex items-center gap-1" title="Source">
                  <Link2 className="h-3 w-3" />
                  {note.source}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 p-4 dark:border-slate-700">
          {showDeleteConfirm ? (
            <div className="flex-1 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
              <p className="mb-2 text-sm text-red-800 dark:text-red-300">Delete this note?</p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={(): void => {
                    void handleDelete();
                  }}
                  disabled={deleting}
                  isLoading={deleting}
                >
                  Delete
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={(): void => {
                    setShowDeleteConfirm(false);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={(): void => {
                setShowDeleteConfirm(true);
              }}
              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
          )}

          <div className="flex gap-2">
            {isEditing ? (
              <>
                <Button type="button" variant="secondary" onClick={handleCancel} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={(): void => {
                    void handleSave();
                  }}
                  disabled={saving}
                  isLoading={saving}
                >
                  Save
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={(): void => {
                  setIsEditing(true);
                }}
              >
                <Edit2 className="mr-1 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
