import { useState } from 'react';
import { Archive, ExternalLink, Globe, Sparkles, Tag, Trash2 } from 'lucide-react';
import type { Bookmark as BookmarkType } from '@/types';
import { formatDate } from '@/utils/dateFormat';
import { getProxiedImageUrl } from '@/utils/imageProxy';
import { getDisplayTitle, getDisplayDescription, getHostname, truncateText } from './shared.js';

interface BookmarkRowProps {
  bookmark: BookmarkType;
  onOpen: () => void;
  onDelete: () => Promise<void>;
  onTagClick: (tag: string) => void;
}

export function BookmarkRow({
  bookmark,
  onOpen,
  onDelete,
  onTagClick,
}: BookmarkRowProps): React.JSX.Element {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [ogImageError, setOgImageError] = useState(false);
  const [faviconError, setFaviconError] = useState(false);

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
    <div className="group relative cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      <div className="grid grid-cols-[40px_1fr_auto_140px_80px] items-center gap-2">
        {/* Thumbnail */}
        <div className="shrink-0">
          {ogImage !== null && !ogImageError ? (
            <img
              src={ogImage}
              alt=""
              className="h-10 w-10 rounded object-cover"
              onError={(): void => { setOgImageError(true); }}
            />
          ) : null}
          <div
            className={`h-10 w-10 items-center justify-center rounded bg-slate-100 dark:bg-slate-700 ${ogImage === null || ogImageError ? 'flex' : 'hidden'}`}
          >
            {favicon !== null && !faviconError ? (
              <img
                src={favicon}
                alt=""
                className="h-6 w-6"
                onError={(): void => { setFaviconError(true); }}
              />
            ) : null}
            <Globe
              className={`h-6 w-6 text-slate-400 dark:text-slate-500 ${favicon === null || faviconError ? '' : 'hidden'}`}
            />
          </div>
        </div>

        {/* Title + hostname */}
        <div className="min-w-0">
          <button onClick={onOpen} className="w-full cursor-pointer text-left" type="button">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                {hasAiSummary ? (
                  <span className="mr-1 inline-flex items-center text-purple-600 dark:text-purple-400">
                    <Sparkles className="mr-0.5 h-3 w-3" />
                  </span>
                ) : null}
                {displayTitle}
              </p>
              {bookmark.archived ? (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-400">
                  <Archive className="mr-1 h-3 w-3" />
                  Archived
                </span>
              ) : null}
            </div>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {getHostname(bookmark.url)}
              {displayDescription !== null ? ` · ${truncateText(displayDescription, 60)}` : null}
            </p>
          </button>
        </div>

        {/* Tags */}
        <div className="flex shrink-0 items-center gap-1">
          {bookmark.tags.slice(0, 2).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={(e): void => {
                e.stopPropagation();
                onTagClick(tag);
              }}
              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 transition-colors hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:hover:bg-blue-900/70"
            >
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </button>
          ))}
          {bookmark.tags.length > 2 ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">+{bookmark.tags.length - 2}</span>
          ) : null}
        </div>

        {/* Time */}
        <div className="text-xs text-slate-400 dark:text-slate-500">
          {formatDate(bookmark.updatedAt)}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-1">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-blue-600 group-hover:opacity-100 dark:hover:bg-slate-700 dark:hover:text-blue-400"
            onClick={(e): void => {
              e.stopPropagation();
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={(e): void => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
            }}
            className="rounded p-1 text-slate-400 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Overlay delete confirmation */}
      {showDeleteConfirm ? (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
          onClick={(e): void => {
            e.stopPropagation();
          }}
        >
          <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 shadow-lg dark:bg-slate-800">
            <p className="text-sm text-slate-700 dark:text-slate-200">Delete this item?</p>
            <button
              onClick={(e): void => {
                e.stopPropagation();
                setShowDeleteConfirm(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={(e): void => {
                e.stopPropagation();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
