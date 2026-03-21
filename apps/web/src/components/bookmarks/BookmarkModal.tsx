import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Calendar,
  Edit2,
  ExternalLink,
  Globe,
  Link2,
  RotateCcw,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Input, MarkdownContent } from '@/components';
import type { Bookmark as BookmarkType, UpdateBookmarkRequest } from '@/types';
import { formatDate } from '@/utils/dateFormat';
import { getProxiedImageUrl } from '@/utils/imageProxy';
import { createBackdropClickHandler, getDisplayTitle, getHostname, OgStatusBadge } from './shared.js';

interface BookmarkModalProps {
  bookmark: BookmarkType;
  onClose: () => void;
  onUpdate: (request: UpdateBookmarkRequest) => Promise<void>;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  onUnarchive: () => Promise<void>;
}

export function BookmarkModal({
  bookmark,
  onClose,
  onUpdate,
  onDelete,
  onArchive,
  onUnarchive,
}: BookmarkModalProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(bookmark.title ?? '');
  const [description, setDescription] = useState(bookmark.description ?? '');
  const [tags, setTags] = useState(bookmark.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await onUpdate({
        title: title.trim() === '' ? null : title.trim(),
        description: description.trim() === '' ? null : description.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t !== ''),
      });
      setIsEditing(false);
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

  const handleArchiveToggle = async (): Promise<void> => {
    setArchiving(true);
    try {
      if (bookmark.archived) {
        await onUnarchive();
      } else {
        await onArchive();
      }
    } finally {
      setArchiving(false);
    }
  };

  const handleCancel = (): void => {
    setTitle(bookmark.title ?? '');
    setDescription(bookmark.description ?? '');
    setTags(bookmark.tags.join(', '));
    setIsEditing(false);
    setShowDeleteConfirm(false);
  };

  const ogImage = getProxiedImageUrl(bookmark.ogPreview?.image);
  const favicon = getProxiedImageUrl(bookmark.ogPreview?.favicon);
  const siteName = bookmark.ogPreview?.siteName;

  const handleBackdropClick = createBackdropClickHandler(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-slate-800">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {isEditing ? 'Edit Bookmark' : 'View Bookmark'}
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
                placeholder="Enter bookmark title (optional)"
              />
              <div className="space-y-1">
                <label htmlFor="description" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Description
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e): void => {
                    setDescription(e.target.value);
                  }}
                  rows={4}
                  placeholder="Enter description (optional)"
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
          ) : (
            <div className="space-y-4">
              {ogImage !== null ? (
                <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <img
                    src={ogImage}
                    alt=""
                    className="h-48 w-full object-cover"
                    onError={(e): void => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
              ) : null}

              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                {favicon !== null ? (
                  <img
                    src={favicon}
                    alt=""
                    className="h-4 w-4"
                    onError={(e): void => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : (
                  <Globe className="h-4 w-4" />
                )}
                <span>{siteName ?? getHostname(bookmark.url)}</span>
                <OgStatusBadge status={bookmark.ogFetchStatus} />
                {bookmark.archived ? (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                    <Archive className="mr-1 h-3 w-3" />
                    Archived
                  </span>
                ) : null}
              </div>

              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{getDisplayTitle(bookmark)}</h3>

              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline dark:text-blue-400 dark:hover:text-blue-300"
              >
                <span className="min-w-0 truncate">{bookmark.url}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>

              {bookmark.aiSummary !== null && bookmark.aiSummary !== '' ? (
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-900/30">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-purple-700 dark:text-purple-300">
                    <Sparkles className="h-4 w-4" />
                    AI Summary
                  </div>
                  <MarkdownContent content={bookmark.aiSummary} />
                </div>
              ) : null}

              {bookmark.description !== null && bookmark.description !== '' ? (
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</p>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{bookmark.description}</p>
                </div>
              ) : null}

              {bookmark.ogPreview?.description !== undefined &&
              bookmark.ogPreview.description !== '' &&
              bookmark.description !== bookmark.ogPreview.description ? (
                <div>
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Page Description</p>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{bookmark.ogPreview.description}</p>
                </div>
              ) : null}

              {bookmark.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {bookmark.tags.map((tag) => (
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

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
                <span className="flex items-center gap-1" title="Created">
                  <Calendar className="h-3 w-3" />
                  {formatDate(bookmark.createdAt)}
                </span>
                <span className="flex items-center gap-1" title="Updated">
                  <RotateCcw className="h-3 w-3" />
                  {formatDate(bookmark.updatedAt)}
                </span>
                <span className="flex items-center gap-1" title="Source">
                  <Link2 className="h-3 w-3" />
                  {bookmark.source}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 p-4 dark:border-slate-700">
          <div className="flex items-center gap-2">
            {showDeleteConfirm ? (
              <div className="flex-1 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/30">
                <p className="mb-2 text-sm text-red-800 dark:text-red-300">Delete this bookmark?</p>
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
              <>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(): void => {
                    void handleArchiveToggle();
                  }}
                  disabled={archiving}
                  isLoading={archiving}
                >
                  {bookmark.archived ? (
                    <>
                      <ArchiveRestore className="mr-1 h-4 w-4" />
                      Unarchive
                    </>
                  ) : (
                    <>
                      <Archive className="mr-1 h-4 w-4" />
                      Archive
                    </>
                  )}
                </Button>
              </>
            )}
          </div>

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
