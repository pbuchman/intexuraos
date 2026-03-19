import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '@/components';

interface CreateNoteModalProps {
  onClose: () => void;
  onCreate: (title: string, content: string, tags: string[]) => Promise<void>;
}

export function CreateNoteModal({ onClose, onCreate }: CreateNoteModalProps): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (title.trim() === '') {
      setError('Title is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');
      await onCreate(title.trim(), content, parsedTags);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
    } finally {
      setSaving(false);
    }
  };

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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create New Note</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {error !== null ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </div>
          ) : null}

          <div className="space-y-4">
            <Input
              label="Title"
              value={title}
              onChange={(e): void => {
                setTitle(e.target.value);
              }}
              placeholder="Enter note title"
            />
            <div className="space-y-1">
              <label htmlFor="create-content" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Content
              </label>
              <textarea
                id="create-content"
                value={content}
                onChange={(e): void => {
                  setContent(e.target.value);
                }}
                rows={8}
                placeholder="Enter note content"
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
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={(): void => {
              void handleCreate();
            }}
            disabled={saving}
            isLoading={saving}
          >
            Create Note
          </Button>
        </div>
      </div>
    </div>
  );
}
