import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bookmark,
  Calendar,
  Edit2,
  ExternalLink,
  Globe,
  Link2,
  Plus,
  RotateCcw,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Card, Input, Layout, MarkdownContent, RefreshIndicator } from '@/components';
import { useAuth } from '@/context';
import { useBookmarkChanges, useBookmarks } from '@/hooks';
import { ApiError } from '@/services/apiClient';
import { getBookmark as getBookmarkApi, type ListBookmarksFilters } from '@/services/bookmarksApi';
import type { Bookmark as BookmarkType, OgFetchStatus, UpdateBookmarkRequest } from '@/types';
import { getProxiedImageUrl } from '@/utils/imageProxy';

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function truncateText(text: string, maxLength = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength).trim() + '...';
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function getDisplayTitle(bookmark: BookmarkType): string {
  if (bookmark.title !== null && bookmark.title !== '') {
    return bookmark.title;
  }
  if (bookmark.ogPreview?.title !== undefined && bookmark.ogPreview.title !== '') {
    return bookmark.ogPreview.title;
  }
  return getHostname(bookmark.url);
}

function getDisplayDescription(bookmark: BookmarkType): string | null {
  if (bookmark.aiSummary !== null && bookmark.aiSummary !== '') {
    return bookmark.aiSummary;
  }
  if (bookmark.description !== null && bookmark.description !== '') {
    return bookmark.description;
  }
  if (bookmark.ogPreview?.description !== undefined && bookmark.ogPreview.description !== '') {
    return bookmark.ogPreview.description;
  }
  return null;
}

const OG_STATUS_STYLES: Record<OgFetchStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Fetching...' },
  processed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Loaded' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
};

interface OgStatusBadgeProps {
  status: OgFetchStatus;
}

function OgStatusBadge({ status }: OgStatusBadgeProps): React.JSX.Element | null {
  if (status === 'processed') {
    return null;
  }
  const style = OG_STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

interface FilterBarProps {
  filters: ListBookmarksFilters;
  onFiltersChange: (filters: ListBookmarksFilters) => void;
  availableTags: string[];
}

function FilterBar({ filters, onFiltersChange, availableTags }: FilterBarProps): React.JSX.Element {
  const archiveOptions = [
    { value: undefined, label: 'All' },
    { value: false, label: 'Active' },
    { value: true, label: 'Archived' },
  ];

  const hasFilters =
    filters.archived !== undefined ||
    (filters.tags !== undefined && filters.tags.length > 0) ||
    filters.ogFetchStatus !== undefined;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <select
        value={filters.archived === undefined ? '' : String(filters.archived)}
        onChange={(e): void => {
          const val = e.target.value;
          const newFilters: ListBookmarksFilters = {};
          if (val !== '') {
            newFilters.archived = val === 'true';
          }
          if (filters.tags !== undefined) {
            newFilters.tags = filters.tags;
          }
          if (filters.ogFetchStatus !== undefined) {
            newFilters.ogFetchStatus = filters.ogFetchStatus;
          }
          onFiltersChange(newFilters);
        }}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      >
        {archiveOptions.map((opt) => (
          <option key={String(opt.value)} value={String(opt.value ?? '')}>
            {opt.label}
          </option>
        ))}
      </select>

      {availableTags.length > 0 ? (
        <select
          value={filters.tags !== undefined && filters.tags.length > 0 ? filters.tags[0] : ''}
          onChange={(e): void => {
            const val = e.target.value;
            const newFilters: ListBookmarksFilters = {};
            if (filters.archived !== undefined) {
              newFilters.archived = filters.archived;
            }
            if (val !== '') {
              newFilters.tags = [val];
            }
            if (filters.ogFetchStatus !== undefined) {
              newFilters.ogFetchStatus = filters.ogFetchStatus;
            }
            onFiltersChange(newFilters);
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        >
          <option value="">All Tags</option>
          {availableTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
      ) : null}

      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={(): void => {
            onFiltersChange({});
          }}
        >
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

interface BookmarkModalProps {
  bookmark: BookmarkType;
  onClose: () => void;
  onUpdate: (request: UpdateBookmarkRequest) => Promise<void>;
  onDelete: () => Promise<void>;
  onArchive: () => Promise<void>;
  onUnarchive: () => Promise<void>;
}

function BookmarkModal({
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
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-slate-900">
            {isEditing ? 'Edit Bookmark' : 'View Bookmark'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
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
                <label htmlFor="description" className="block text-sm font-medium text-slate-700">
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
                  className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
                <div className="overflow-hidden rounded-lg border border-slate-200">
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

              <div className="flex items-center gap-2 text-sm text-slate-500">
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
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    <Archive className="mr-1 h-3 w-3" />
                    Archived
                  </span>
                ) : null}
              </div>

              <h3 className="text-xl font-semibold text-slate-900">{getDisplayTitle(bookmark)}</h3>

              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                <span className="min-w-0 truncate">{bookmark.url}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>

              {bookmark.aiSummary !== null && bookmark.aiSummary !== '' ? (
                <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-purple-700">
                    <Sparkles className="h-4 w-4" />
                    AI Summary
                  </div>
                  <MarkdownContent content={bookmark.aiSummary} />
                </div>
              ) : null}

              {bookmark.description !== null && bookmark.description !== '' ? (
                <div>
                  <p className="text-sm font-medium text-slate-700">Description</p>
                  <p className="mt-1 text-slate-600">{bookmark.description}</p>
                </div>
              ) : null}

              {bookmark.ogPreview?.description !== undefined &&
              bookmark.ogPreview.description !== '' &&
              bookmark.description !== bookmark.ogPreview.description ? (
                <div>
                  <p className="text-sm font-medium text-slate-700">Page Description</p>
                  <p className="mt-1 text-slate-600">{bookmark.ogPreview.description}</p>
                </div>
              ) : null}

              {bookmark.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {bookmark.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-sm font-medium text-blue-800"
                    >
                      <Tag className="h-3 w-3" />
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
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

        <div className="flex items-center justify-between border-t border-slate-200 p-4">
          <div className="flex items-center gap-2">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-red-600">Delete this bookmark?</span>
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
                  Confirm
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
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(): void => {
                    setShowDeleteConfirm(true);
                  }}
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
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

function CreateBookmarkModal({
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
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-slate-900">Create New Bookmark</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {duplicateBookmarkId !== null ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-800">Duplicate URL</p>
                  <p className="mt-1 text-sm text-amber-700">{error}</p>
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
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
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
                className="block text-sm font-medium text-slate-700"
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
                className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
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

interface BookmarkRowProps {
  bookmark: BookmarkType;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  onTagClick: (tag: string) => void;
}

function BookmarkRow({
  bookmark,
  onOpen,
  onDelete,
  onTagClick,
}: BookmarkRowProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (): Promise<void> => {
    setIsDeleting(true);
    try {
      await onDelete();
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const displayTitle = getDisplayTitle(bookmark);
  const displayDescription = getDisplayDescription(bookmark);
  const favicon = getProxiedImageUrl(bookmark.ogPreview?.favicon);
  const ogImage = getProxiedImageUrl(bookmark.ogPreview?.image);
  const hasAiSummary = bookmark.aiSummary !== null && bookmark.aiSummary !== '';

  return (
    <Card>
      <div className="flex gap-4">
        <div className="shrink-0">
          {ogImage !== null ? (
            <img
              src={ogImage}
              alt=""
              className="h-16 w-16 rounded-lg object-cover"
              onError={(e): void => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fallback !== null) {
                  fallback.style.display = 'flex';
                }
              }}
            />
          ) : null}
          <div
            className={`h-16 w-16 items-center justify-center rounded-lg bg-slate-100 ${ogImage !== null ? 'hidden' : 'flex'}`}
          >
            {favicon !== null ? (
              <img
                src={favicon}
                alt=""
                className="h-8 w-8"
                onError={(e): void => {
                  e.currentTarget.style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                  if (fallback !== null) {
                    fallback.style.display = 'block';
                  }
                }}
              />
            ) : null}
            <Globe
              className={`h-8 w-8 text-slate-400 ${favicon !== null ? 'hidden' : ''}`}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="w-full cursor-pointer text-left" type="button">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-medium text-slate-900 transition-colors hover:text-blue-600">
                {displayTitle}
              </h3>
              <div className="flex shrink-0 items-center gap-2">
                {bookmark.archived ? (
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    <Archive className="mr-1 h-3 w-3" />
                    Archived
                  </span>
                ) : null}
                <OgStatusBadge status={bookmark.ogFetchStatus} />
              </div>
            </div>
            {displayDescription !== null ? (
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                {hasAiSummary ? (
                  <span className="mr-1 inline-flex items-center text-purple-600">
                    <Sparkles className="mr-0.5 h-3 w-3" />
                  </span>
                ) : null}
                {truncateText(displayDescription, 150)}
              </p>
            ) : null}
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {bookmark.tags.slice(0, 3).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={(e): void => {
                  e.stopPropagation();
                  onTagClick(tag);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-200"
              >
                <Tag className="h-2.5 w-2.5" />
                {tag}
              </button>
            ))}
            {bookmark.tags.length > 3 ? (
              <span className="text-xs text-slate-400">+{bookmark.tags.length - 3} more</span>
            ) : null}
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-400">{getHostname(bookmark.url)}</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-400">Updated {formatDate(bookmark.updatedAt)}</span>
          </div>
        </div>

        <div className="shrink-0">
          {!showDeleteConfirm ? (
            <div className="flex items-center gap-1">
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-600"
                onClick={(e): void => {
                  e.stopPropagation();
                }}
              >
                <ExternalLink className="h-4 w-4" />
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e): void => {
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                className="text-slate-400 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {showDeleteConfirm ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="mb-3 text-sm text-red-800">Delete "{displayTitle}"?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={(): void => {
                void handleDelete();
              }}
              disabled={isDeleting}
              isLoading={isDeleting}
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
              disabled={isDeleting}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

// 💰 CostGuard: Debounce delay for batch fetching changed bookmarks
const DEBOUNCE_DELAY_MS = 500;

export function BookmarksListPage(): React.JSX.Element {
  const { getAccessToken } = useAuth();
  const {
    bookmarks,
    loading,
    refreshing,
    error,
    filters,
    setFilters,
    refreshBookmarkById,
    createBookmark,
    updateBookmark,
    deleteBookmark,
    archiveBookmark,
    unarchiveBookmark,
  } = useBookmarks();
  const [selectedBookmark, setSelectedBookmark] = useState<BookmarkType | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // 💰 CostGuard: Real-time bookmark listener for enrichment updates
  const { changedBookmarkIds, clearChangedIds } = useBookmarkChanges();
  const debounceTimeoutRef = useRef<number | null>(null);

  // 💰 CostGuard: Debounced effect for fetching changed bookmarks
  useEffect(() => {
    if (changedBookmarkIds.length === 0) return;

    if (debounceTimeoutRef.current !== null) {
      window.clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = window.setTimeout(() => {
      // Fetch each changed bookmark (typically just one at a time for enrichment)
      for (const id of changedBookmarkIds) {
        void refreshBookmarkById(id);
      }
      clearChangedIds();
    }, DEBOUNCE_DELAY_MS);

    return (): void => {
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [changedBookmarkIds, refreshBookmarkById, clearChangedIds]);

  useEffect(() => {
    const bookmarkId = searchParams.get('id');
    if (bookmarkId !== null && bookmarks.length > 0) {
      const bookmark = bookmarks.find((b) => b.id === bookmarkId);
      if (bookmark !== undefined) {
        setSelectedBookmark(bookmark);
        setSearchParams({}, { replace: true });
      }
    }
  }, [bookmarks, searchParams, setSearchParams]);

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    bookmarks.forEach((b) => {
      b.tags.forEach((t) => {
        tagSet.add(t);
      });
    });
    return Array.from(tagSet).sort();
  }, [bookmarks]);

  const handleTagClick = useCallback(
    (tag: string): void => {
      const newFilters: ListBookmarksFilters = { tags: [tag] };
      if (filters.archived !== undefined) {
        newFilters.archived = filters.archived;
      }
      if (filters.ogFetchStatus !== undefined) {
        newFilters.ogFetchStatus = filters.ogFetchStatus;
      }
      setFilters(newFilters);
    },
    [filters, setFilters]
  );

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">My Bookmarks</h2>
          <p className="text-slate-600">Save and organize your favorite links.</p>
        </div>
        <Button
          type="button"
          variant="primary"
          onClick={(): void => {
            setShowCreateModal(true);
          }}
        >
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Bookmark</span>
        </Button>
      </div>

      <RefreshIndicator show={refreshing} />

      <FilterBar filters={filters} onFiltersChange={setFilters} availableTags={availableTags} />

      {error !== null && error !== '' ? (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      ) : null}

      {bookmarks.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Bookmark className="mb-4 h-12 w-12 text-slate-300" />
            <h3 className="mb-2 text-lg font-medium text-slate-900">No bookmarks yet</h3>
            <p className="mb-4 text-slate-500">Save your first bookmark to get started.</p>
            <Button
              type="button"
              variant="primary"
              onClick={(): void => {
                setShowCreateModal(true);
              }}
            >
              <Plus className="h-4 w-4 sm:mr-2" />
              <span className="hidden sm:inline">New Bookmark</span>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {bookmarks.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              onOpen={(): void => {
                setSelectedBookmark(bookmark);
              }}
              onDelete={async (): Promise<void> => {
                await deleteBookmark(bookmark.id);
              }}
              onTagClick={handleTagClick}
            />
          ))}
        </div>
      )}

      {selectedBookmark !== null ? (
        <BookmarkModal
          bookmark={selectedBookmark}
          onClose={(): void => {
            setSelectedBookmark(null);
          }}
          onUpdate={async (request): Promise<void> => {
            const updated = await updateBookmark(selectedBookmark.id, request);
            setSelectedBookmark(updated);
          }}
          onDelete={async (): Promise<void> => {
            await deleteBookmark(selectedBookmark.id);
          }}
          onArchive={async (): Promise<void> => {
            const updated = await archiveBookmark(selectedBookmark.id);
            setSelectedBookmark(updated);
          }}
          onUnarchive={async (): Promise<void> => {
            const updated = await unarchiveBookmark(selectedBookmark.id);
            setSelectedBookmark(updated);
          }}
        />
      ) : null}

      {showCreateModal ? (
        <CreateBookmarkModal
          onClose={(): void => {
            setShowCreateModal(false);
          }}
          onCreate={async (url, title, description, tags): Promise<void> => {
            const request: Parameters<typeof createBookmark>[0] = {
              url,
              tags,
              source: 'web',
              sourceId: `web-${String(Date.now())}`,
            };
            if (title !== null) {
              request.title = title;
            }
            if (description !== null) {
              request.description = description;
            }
            await createBookmark(request);
          }}
          onViewExisting={(bookmarkId): void => {
            setShowCreateModal(false);
            const existingBookmark = bookmarks.find((b) => b.id === bookmarkId);
            if (existingBookmark !== undefined) {
              setSelectedBookmark(existingBookmark);
            } else {
              void (async (): Promise<void> => {
                const token = await getAccessToken();
                const bookmark = await getBookmarkApi(token, bookmarkId);
                setSelectedBookmark(bookmark);
              })();
            }
          }}
        />
      ) : null}
    </Layout>
  );
}
