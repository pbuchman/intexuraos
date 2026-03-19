import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button, Input } from '@/components';
import { ApiError } from '@/services/apiClient';
import { createBackdropClickHandler } from './shared.js';

interface CreateBookmarkModalProps {
  onClose: () => void;
  onCreate: (
    url: string,
    title: string | null,
    description: string | null,
    tags: string[]
  ) => Promise<void>;
  onViewExisting: (bookmarkId: string) => void;
}

export function CreateBookmarkModal({
  onClose,
  onCreate,
  onViewExisting,
}: CreateBookmarkModalProps): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateBookmarkId, setDuplicateBookmarkId] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (url.trim() === '') {
      setError('URL is required');
      return;
    }

    try {
      new URL(url.trim());
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setSaving(true);
    setError(null);
    setDuplicateBookmarkId(null);
    try {
      const parsedTags = tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');
      await onCreate(
        url.trim(),
        title.trim() === '' ? null : title.trim(),
        description.trim() === '' ? null : description.trim(),
        parsedTags
      );
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CONFLICT') {
        const existingId = (err.details as { existingBookmarkId?: string } | undefined)
          ?.existingBookmarkId;
        if (existingId !== undefined) {
          setDuplicateBookmarkId(existingId);
          setError('You already have a bookmark for this URL.');
        } else {
          setError(err.message);
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to create bookmark');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleViewExisting = (): void => {
    if (duplicateBookmarkId !== null) {
      onViewExisting(duplicateBookmarkId);
    }
  };

  const handleBackdropClick = createBackdropClickHandler(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create New Bookmark</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {duplicateBookmarkId !== null ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/30">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Duplicate URL</p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{error}</p>
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={handleViewExisting}
                    >
                      View Existing Bookmark
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : error !== null ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
              {error}
            </div>
          ) : null}

          <div className="space-y-4">
            <Input
              label="URL"
              value={url}
              onChange={(e): void => {
                setUrl(e.target.value);
              }}
              placeholder="https://example.com/article"
            />
            <Input
              label="Title (optional - will be fetched from page)"
              value={title}
              onChange={(e): void => {
                setTitle(e.target.value);
              }}
              placeholder="Enter title"
            />
            <div className="space-y-1">
              <label
                htmlFor="create-description"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300"
              >
                Description (optional)
              </label>
              <textarea
                id="create-description"
                value={description}
                onChange={(e): void => {
                  setDescription(e.target.value);
                }}
                rows={3}
                placeholder="Enter description"
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
            </div>
            <Input
              label="Tags (comma separated)"
              value={tags}
              onChange={(e): void => {
                setTags(e.target.value);
              }}
              placeholder="e.g., work, reading, important"
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
            Create Bookmark
          </Button>
        </div>
      </div>
    </div>
  );
}
